import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);
import type { Action, ActionResult, MemoryReference, ScreenContext } from '../types';
import type { VoiceFeedbackService } from '../services/voice-feedback';
import { ExplainabilityNotifier } from '../services/explainability-notifier';
import { RemindersService } from '../services/reminders';
import { GhostAPIClient } from '../services/api-client';
import { fileScanner } from '../files/file-scanner';
import { showOverlayToast } from '../services/overlay-notifier';

/**
 * Executes actions returned by the backend.
 * Supports voice feedback via optional VoiceFeedbackService.
 */
export class ActionExecutor {
  constructor(
    private voiceFeedback?: VoiceFeedbackService,
    private explainabilityNotifier?: ExplainabilityNotifier,
    private remindersService?: RemindersService,
    private apiClient?: GhostAPIClient
  ) { }

  async execute(
    action: Action,
    context?: { commandId: string; memories: MemoryReference[]; screenContext?: { text: string; screenshotPath: string } }
  ): Promise<ActionResult> {
    // Provide instant acknowledgment to reduce perceived latency
    if (this.voiceFeedback) {
      const ack = this.voiceFeedback.getAcknowledgment(action);
      if (ack) {
        // Don't await - let it speak in background while we work
        this.voiceFeedback.provideFeedback(action, {
          action,
          status: 'success',
          executedAt: new Date().toISOString(),
        }).catch(() => { }); // Suppress errors for acknowledgment
      }
    }

    let result: ActionResult;

    switch (action.type) {
      case 'file.open':
        result = await this.openFile(action);
        break;
      case 'file.scroll':
        result = await this.scroll(action);
        break;
      case 'file.index':
        result = await this.indexFile(action);
        break;
      case 'info.recall':
      case 'info.summarize': // Handle LLM variation
        result = await this.recallInfo(action, context);
        break;
      case 'reminder.create':
        result = await this.createReminder(action, context);
        break;
      case 'search.query':
        result = await this.searchMemories(action);
        break;
      default:
        result = {
          action,
          status: 'failed',
          error: 'Unsupported action type',
          executedAt: new Date().toISOString(),
        };
    }

    // Show explainability notification if memories were used
    if (
      result.status === 'success' &&
      this.explainabilityNotifier &&
      context &&
      context.memories.length > 0
    ) {
      // Don't show duplicate notification for info.recall if we already showed one
      // But actually info.recall shows the *content*, this shows the *source*.
      // So showing both might be okay, or we can suppress the source one if it's redundant.
      // For now, let's show it to give the "Found in..." context.
      await this.explainabilityNotifier.showContextNotification({
        commandId: context.commandId,
        summary: ExplainabilityNotifier.generateSummary(context.memories),
        memoryCount: context.memories.length,
        primarySource: context.memories[0]?.metadata?.source,
        memories: context.memories,
      }).catch(err => console.error('[Ghost] Notification failed:', err));
    }

    // Provide voice feedback if available
    // Provide voice feedback if available
    // BUT skip it if we are in a conversational flow (which main.ts handles via assistant_text)
    // Actually, main.ts handles assistant_text, but action executor handles action feedback.
    // We want to avoid double speaking.
    // Ideally, we only speak here if there was NO assistant_text, or if the action is async/long-running.
    // For now, let's disable generic action feedback to fix the echo, as the LLM usually confirms the action.
    /*
    if (this.voiceFeedback) {
      await this.voiceFeedback.provideFeedback(action, result).catch((err) =>
        console.error('[Ghost][ActionExecutor] Voice feedback failed:', err)
      );
    }
    */

    return result;
  }

  async executeBatch(
    actions: Action[],
    context?: { commandId: string; memories: MemoryReference[]; screenContext?: { text: string; screenshotPath: string } }
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const action of actions) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.execute(action, context);
      results.push(result);
    }
    return results;
  }

  private async openFile(action: Action): Promise<ActionResult> {
    const rawPath = action.params.path as string;
    const executedAt = new Date().toISOString();

    // Handle common directory intents
    const resolvedPath = this.resolvePath(rawPath);
    if (!resolvedPath) {
      return { action, status: 'failed', error: 'Invalid file path', executedAt };
    }
    const normalized = path.normalize(resolvedPath);

    // Security: Prevent path traversal attempts
    if (normalized.includes('..')) {
      return { action, status: 'failed', error: 'Path traversal detected', executedAt };
    }

    const home = process.env.HOME || '';
    const isAllowedPath = (p: string) =>
      p.startsWith(home) || p.startsWith('/tmp') || p.startsWith('/private/tmp');

    let finalPath = normalized;
    let usedSpotlight = false;

    if (!fs.existsSync(finalPath)) {
      // Hackathon Fallback: Try to find the file via Spotlight if it doesn't exist directly
      // This handles cases where the LLM guesses the path or only has the filename
      console.log(`[Ghost][OpenFile] Path not found: ${finalPath}. Trying Spotlight...`);
      const basename = path.basename(finalPath);

      try {
        // mdfind -name "filename" | head -n 1
        const { stdout } = await execAsync(`mdfind -name "${basename}" | head -n 1`);
        const spotlightPath = stdout.trim();

        if (spotlightPath && fs.existsSync(spotlightPath)) {
          console.log(`[Ghost][OpenFile] Spotlight found: ${spotlightPath}`);
          finalPath = spotlightPath;
          usedSpotlight = true;
        }
      } catch (err) {
        console.warn('[Ghost][OpenFile] Spotlight search failed:', err);
      }

      if (!fs.existsSync(finalPath)) {
        return { action, status: 'failed', error: 'File not found', executedAt };
      }
    }

    // Enforce home/tmp boundaries for direct paths; allow Spotlight results to bypass if needed
    if (!usedSpotlight && !isAllowedPath(finalPath)) {
      return { action, status: 'failed', error: 'Path traversal detected: Access denied outside home directory', executedAt };
    }

    const opener = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';

    const search = action.params.search as string | undefined;

    return new Promise<ActionResult>((resolve) => {
      execFile(opener, [finalPath], (error) => {
        if (error) {
          resolve({ action, status: 'failed', error: error.message, executedAt });
          return;
        }

        // If search param is present, use AppleScript to Find in Page (macOS only)
        if (search && process.platform === 'darwin') {
          // Wait a moment for the app to focus
          setTimeout(() => {
            const script = `
              tell application "System Events"
                keystroke "f" using command down
                delay 0.2
                keystroke "${search.replace(/"/g, '\\"')}"
                delay 0.2
                keystroke return
                delay 0.2
                keystroke escape -- Close find bar but keep selection
              end tell
            `;
            execFile('osascript', ['-e', script], (err) => {
              if (err) console.warn('[Ghost][OpenFile] Search script failed:', err);
            });
          }, 1000); // 1s delay to ensure file is open
        }

        resolve({ action, status: 'success', executedAt });
      });
    });
  }

  private resolvePath(p: string | undefined): string | null {
    if (!p) return null;
    const lower = p.toLowerCase();

    // Map common directory names to user paths
    if (['downloads', 'download folder', 'download', 'my downloads'].includes(lower)) {
      const home = process.env.HOME || '';
      return path.join(home, 'Downloads');
    }
    if (['documents', 'document folder', 'docs'].includes(lower)) {
      const home = process.env.HOME || '';
      return path.join(home, 'Documents');
    }
    if (['desktop', 'my desktop'].includes(lower)) {
      const home = process.env.HOME || '';
      return path.join(home, 'Desktop');
    }

    // Handle home directory expansion
    if (p.startsWith('~/')) {
      const home = process.env.HOME || '';
      return path.join(home, p.slice(2));
    }

    // Handle relative paths (assume relative to home for now, or cwd)
    // For safety, let's assume if it's not absolute and not home-relative, we try to find it in home
    if (!path.isAbsolute(p)) {
      const home = process.env.HOME || '';
      const inHome = path.join(home, p);
      if (fs.existsSync(inHome)) return inHome;

      // Also try current working directory if it makes sense, but for a daemon it might be weird
      const cwd = process.cwd();
      const inCwd = path.join(cwd, p);
      if (fs.existsSync(inCwd)) return inCwd;
    }

    if (path.isAbsolute(p)) return p;
    return null;
  }

  private async scroll(action: Action): Promise<ActionResult> {
    const executedAt = new Date().toISOString();
    const direction = (action.params.direction as string) || 'down';
    const amount = Math.max(1, Math.round(Number(action.params.amount ?? 1)));

    if (process.platform !== 'darwin') {
      return { action, status: 'failed', error: 'Scrolling only supported on macOS in this build', executedAt };
    }

    // Safety: break big scrolls into a limited number of page-step pulses
    const keyCode = direction === 'up' ? 116 : 121; // 116=Page Up, 121=Page Down
    const MAX_STEPS = 30; // tighter cap to avoid runaway scroll that can lock input
    const STEP_SIZE = 800; // pixels per "page" equivalent
    const STEP_DELAY = 0.08; // slightly slower to accommodate heavy viewers/PDFs
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(amount / STEP_SIZE)));
    const script = `tell application "System Events"\nrepeat ${steps} times\nkey code ${keyCode}\ndelay ${STEP_DELAY}\nend repeat\nend tell`;

    return new Promise<ActionResult>((resolve) => {
      const child = execFile('osascript', ['-e', script], { timeout: 4000 }, (error) => {
        if (error) {
          resolve({ action, status: 'failed', error: error.message, executedAt });
          return;
        }
        resolve({ action, status: 'success', executedAt });
      });

      // Extra safety: kill the script if it hangs beyond timeout (execFile will also enforce timeout)
      child.on('error', (err) => {
        resolve({ action, status: 'failed', error: err.message, executedAt });
      });
    });
  }

  private async indexFile(action: Action): Promise<ActionResult> {
    const executedAt = new Date().toISOString();
    const rawPath = action.params.path as string;

    if (!this.apiClient) {
      return { action, status: 'failed', error: 'API client not available', executedAt };
    }

    const resolvedPath = this.resolvePath(rawPath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return { action, status: 'failed', error: `Path not found: ${rawPath}`, executedAt };
    }

    try {
      // Scan the directory (or file)
      // fileScanner.scan expects an array of directories
      const isDirectory = fs.statSync(resolvedPath).isDirectory();
      const scanDirs = isDirectory ? [resolvedPath] : [path.dirname(resolvedPath)];

      // If it's a single file, we might want to just index that one file, 
      // but fileScanner is built for dirs. Let's just scan the dir for now, 
      // or maybe we can filter?
      // For simplicity, let's scan the directory.

      showOverlayToast('Ghost', `Scanning ${resolvedPath}...`);

      const files = await fileScanner.scan(scanDirs, {
        forceRescan: true,
        limit: 500
      });

      if (files.length === 0) {
        return { action, status: 'success', error: 'No files found to index', executedAt };
      }

      const result = await this.apiClient.indexFiles(files);

      if (!result.ok) {
        throw new Error((result as any).error?.message || 'Failed to index files');
      }

      showOverlayToast('Ghost', `Indexed ${files.length} files from ${path.basename(resolvedPath)}`);
      return { action, status: 'success', executedAt };

    } catch (error) {
      return {
        action,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Indexing failed',
        executedAt
      };
    }
  }

  private async recallInfo(action: Action, context?: { commandId: string; memories: MemoryReference[]; screenContext?: ScreenContext }): Promise<ActionResult> {
    const executedAt = new Date().toISOString();
    const summary = action.params.summary as string;

    // Demo mode: Check if any of the recalled memories is a reminder
    if (context?.memories) {
      const reminderMemories = context.memories.filter(m => m.type === 'reminder');

      if (reminderMemories.length > 0) {
        // Found reminder(s)! Extract file path and screenshot from metadata
        for (const reminder of reminderMemories) {
          const metadata = reminder.metadata || {};
          const screenshot = metadata.screenshot;
          const fileContext = metadata.context || '';
          const windowTitle = metadata.windowTitle;

          // Primary: Use windowTitle if available (most reliable)
          // Fallback: Extract from OCR context
          let filePath: string | null = null;

          if (windowTitle) {
            // If windowTitle looks like a filename, use it directly
            if (windowTitle.includes('.')) {
              filePath = windowTitle;
              console.log('[Ghost][Recall] Using windowTitle as file path:', filePath);
            }
          }

          // Fallback to OCR parsing
          if (!filePath && fileContext) {
            const filePathMatch = fileContext.match(/(?:Active file|File|Path):\s*([^\s\n]+)/i);
            filePath = filePathMatch ? filePathMatch[1] : null;
            if (filePath) {
              console.log('[Ghost][Recall] Extracted file path from context:', filePath);
            }
          }

          // Enhanced summary with screenshot reference
          let enhancedSummary = summary;
          if (screenshot) {
            enhancedSummary += `\n\nScreenshot: ${screenshot}`;
          }

          // Auto-open file if available (demo mode)
          if (filePath) {
            console.log('[Ghost][Recall] Auto-opening file from reminder:', filePath);
            await this.openFile({
              type: 'file.open',
              params: { path: filePath }
            });
            enhancedSummary += `\n\nOpening: ${path.basename(filePath)}`;
          }

          showOverlayToast('Ghost', enhancedSummary);
          return { action, status: 'success', executedAt };
        }
      }
    }

    // Normal recall (no reminder)
    showOverlayToast('Ghost', summary || 'No summary provided');
    return { action, status: 'success', executedAt };
  }


  private async createReminder(action: Action, context?: { commandId: string; memories: MemoryReference[]; screenContext?: ScreenContext }): Promise<ActionResult> {
    const executedAt = new Date().toISOString();
    const { title, notes, dueDate } = action.params;

    // Validate title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return { action, status: 'failed', error: 'Reminder title is required', executedAt };
    }

    // Enhanced notes with screen context for demo mode
    let enrichedNotes = notes || '';
    if (context?.screenContext) {
      enrichedNotes += `\n\nContext: ${context.screenContext.text.slice(0, 200)}`;
      enrichedNotes += `\nScreenshot: ${context.screenContext.screenshotPath}`;
    }

    // macOS-only: create reminder via AppleScript to avoid missing Swift helper
    if (process.platform === 'darwin') {
      const esc = (s: string) => s.replace(/"/g, '\\"');
      const dueLine = dueDate ? `set due date of newReminder to date "${esc(dueDate)}"` : '';
      const noteLine = enrichedNotes ? `set body of newReminder to "${esc(enrichedNotes)}"` : '';
      const script = `
        tell application "Reminders"
          set newReminder to make new reminder with properties {name:"${esc(title.trim())}"}
          ${dueLine}
          ${noteLine}
        end tell
      `;

      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        execFile('osascript', ['-e', script], { timeout: 5000 }, (error) => {
          if (error) {
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true });
          }
        });
      });

      if (!result.success) {
        return { action, status: 'failed', error: result.error || 'Failed to create reminder', executedAt };
      }
    } else {
      return { action, status: 'failed', error: 'Reminders are only supported on macOS in this build', executedAt };
    }

    // ALSO store as a Ghost memory for searchability (demo mode)
    const hadScreenContextProp = !!context && Object.prototype.hasOwnProperty.call(context, 'screenContext');
    if (this.apiClient && (context?.screenContext || hadScreenContextProp)) {
      try {
        await this.apiClient.createMemory({
          type: 'reminder',
          summary: `Reminder: ${title}. ${notes || ''}`,
          metadata: {
            screenshot: context?.screenContext?.screenshotPath,
            context: context?.screenContext?.text,
            windowTitle: (context?.screenContext as any)?.windowTitle,
            dueDate: dueDate || executedAt,
            completed: false
          }
        });
        console.log('[Ghost][Reminder] Stored as searchable memory');
      } catch (err) {
        console.error('[Ghost][Reminder] Failed to store as memory:', err);
        // Don't fail the whole reminder if memory storage fails
      }
    }

    showOverlayToast('Ghost', `Reminder created: ${title}`);
    return { action, status: 'success', executedAt };
  }


  private async searchMemories(action: Action): Promise<ActionResult> {
    const executedAt = new Date().toISOString();
    const { query } = action.params;

    if (!query) {
      return { action, status: 'failed', error: 'Search query is required', executedAt };
    }

    try {
      // Call the backend search API
      const backendUrl = process.env.GHOST_BACKEND_URL || 'http://localhost:4000';
      const response = await fetch(`${backendUrl}/api/search?q=${encodeURIComponent(query)}&limit=5`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const results = data.results || [];

      if (results.length === 0) {
        showOverlayToast('Ghost Search', `No results found for "${query}"`);
      } else {
        const topResults = results.slice(0, 3).map((r: any) => r.memory.summary).join('\n• ');
        showOverlayToast(`Found ${results.length} results`, `• ${topResults}`);
      }

      return { action, status: 'success', executedAt };
    } catch (error) {
      return {
        action,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Search failed',
        executedAt
      };
    }
  }
}

// Export singleton without voice feedback for backward compatibility
export const actionExecutor = new ActionExecutor();
