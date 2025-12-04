import type { CommandRequest, CommandResponse, ProcessError, Result } from '../types.js';
import type { ContextBuilder } from './context-builder.js';
import type { LLMCoordinator } from './llm-coordinator.js';
import type { MemoryService } from './memory.js';
import type { SQLiteStorage } from './sqlite-storage.js';
import { contextBuilder as defaultContextBuilder } from './context-builder.js';
import { llmCoordinator as defaultLlmCoordinator } from './llm-coordinator.js';
import { memoryService as defaultMemoryService } from './memory.js';
import { storageService as defaultStorageService } from './storage.js';

import { EventEmitter } from 'node:events';

/**
 * Main entry point for processing a command request end-to-end.
 * Supports dependency injection for better testability.
 */
export class CommandProcessor extends EventEmitter {
  private contextBuilder: ContextBuilder;
  private llmCoordinator: LLMCoordinator;
  private memoryService: MemoryService;
  private storageService: SQLiteStorage;

  /**
   * Create a new CommandProcessor instance
   * 
   * @param contextBuilder - Optional ContextBuilder instance (defaults to singleton)
   * @param llmCoordinator - Optional LLMCoordinator instance (defaults to singleton)
   * @param memoryService - Optional MemoryService instance (defaults to singleton)
   * @param storageService - Optional StorageService instance (defaults to singleton)
   */
  constructor(
    contextBuilder?: ContextBuilder,
    llmCoordinator?: LLMCoordinator,
    memoryService?: MemoryService,
    storageService?: SQLiteStorage
  ) {
    super();
    this.contextBuilder = contextBuilder || defaultContextBuilder;
    this.llmCoordinator = llmCoordinator || defaultLlmCoordinator;
    this.memoryService = memoryService || defaultMemoryService;
    this.storageService = storageService || defaultStorageService;
  }

  async process(request: CommandRequest): Promise<Result<CommandResponse, ProcessError>> {
    const validation = this.validate(request);
    if (!validation.ok) {
      return validation;
    }

    // Build context using semantic search via context-engine
    const contextResult = await this.contextBuilder.buildContext(request.text, request.user_id);

    // Debug: raw context-engine memories
    try {
      console.info('[Ghost][CommandProcessor] ContextEngine memories', {
        command: request.text,
        user_id: request.user_id,
        memory_ids: contextResult.memories.map((m) => m.memory.id),
        memory_types: contextResult.memories.map((m) => m.memory.type),
        memory_summaries: contextResult.memories.map((m) => m.memory.summary?.slice(0, 120)),
      });
    } catch (err) {
      console.warn('[Ghost][CommandProcessor] Failed to log context memories', err);
    }

    // Extract memories from context result for LLM and storage
    let memories = contextResult.memories.map(m => m.memory);

    const addTextFallbacks = async () => {
      // Text search fallback for non-file memories (for cases where embeddings miss)
      if (typeof (this.storageService as any).searchMemoriesText === 'function') {
        const textExtras = (this.storageService as any).searchMemoriesText(request.text, request.user_id, 5);
        if (textExtras?.ok && Array.isArray(textExtras.value)) {
          const nonFileTexts = textExtras.value.filter(
            (m: any) =>
              m &&
              !m.type?.startsWith('entity.file') &&
              !m.type?.startsWith('context.screen') &&
              !m.type?.startsWith('fact.command') &&
              !m.type?.startsWith('fact.response')
          );
          if (nonFileTexts.length > 0) {
            memories = [...memories, ...nonFileTexts];
          }
        }
      }

      // If still nothing useful (only screen or empty), grab recent non-screen memories as last resort
      const hasUseful = memories.some(
        (m) =>
          !m.type.startsWith('entity.file') &&
          !m.type.startsWith('context.screen') &&
          !m.type.startsWith('fact.command') &&
          !m.type.startsWith('fact.response')
      );
      if (!hasUseful && typeof (this.storageService as any).getRecentNonScreenMemories === 'function') {
        const recent = (this.storageService as any).getRecentNonScreenMemories(request.user_id, 3);
        if (recent?.ok && Array.isArray(recent.value) && recent.value.length > 0) {
          memories = [...memories, ...recent.value];
        }
      }
    };

    // If no memories at all, try storage search + text fallback
    if (memories.length === 0 && typeof (this.storageService as any).searchMemories === 'function') {
      const extra = await (this.storageService as any).searchMemories(request.text, request.user_id, 6);
      console.info('[Ghost][CommandProcessor] storage.searchMemories (empty context)', extra);
      if (extra?.ok && Array.isArray(extra.value)) {
        memories = extra.value.map((entry: any) => entry.memory).filter(Boolean);
      }
      await addTextFallbacks();
    }

    // If we only have file memories, try to add some non-file context via storage search as a fallback
    const hasNonFile = memories.some(
      (m) =>
        !m.type.startsWith('entity.file') &&
        !m.type.startsWith('context.screen') &&
        !m.type.startsWith('fact.command') &&
        !m.type.startsWith('fact.response')
    );
    if (!hasNonFile && typeof (this.storageService as any).searchMemories === 'function') {
      const extra = await (this.storageService as any).searchMemories(request.text, request.user_id, 3);
      console.info('[Ghost][CommandProcessor] storage.searchMemories (files only)', extra);
      if (extra?.ok && Array.isArray(extra.value)) {
        const nonFileExtras = extra.value
          .map((entry: any) => entry.memory)
          .filter((m: any) => m && !m.type?.startsWith('entity.file'));
        if (nonFileExtras.length > 0) {
          memories = [...memories, ...nonFileExtras];
        }
      }
      await addTextFallbacks();
    }

    // If still no non-file memories, try a keyword fallback for sarah/api/redesign
    const hasNonFileAfter = memories.some(
      (m) =>
        !m.type.startsWith('entity.file') &&
        !m.type.startsWith('context.screen') &&
        !m.type.startsWith('fact.command') &&
        !m.type.startsWith('fact.response')
    );
    if (!hasNonFileAfter && typeof (this.storageService as any).searchMemoriesText === 'function') {
      const keywordQuery = `${request.text} sarah api redesign`;
      const keywordExtras = (this.storageService as any).searchMemoriesText(keywordQuery, request.user_id, 5);
      if (keywordExtras?.ok && Array.isArray(keywordExtras.value)) {
        const nonFileKeywords = keywordExtras.value.filter(
          (m: any) =>
            m &&
            !m.type?.startsWith('entity.file') &&
            !m.type?.startsWith('context.screen') &&
            !m.type?.startsWith('fact.command') &&
            !m.type?.startsWith('fact.response')
        );
        if (nonFileKeywords.length > 0) {
          memories = [...memories, ...nonFileKeywords];
        }
      }
    }

    // If we have any non-conversation, non-screen memories, drop screens/conversation noise
    const nonNoise = memories.filter(
      (m) =>
        !m.type.startsWith('context.screen') &&
        !m.type.startsWith('fact.command') &&
        !m.type.startsWith('fact.response')
    );
    if (nonNoise.length > 0) {
      memories = nonNoise;
    }

    // Debug logging: what memories are being passed to the LLM
    try {
      console.info('[Ghost][CommandProcessor] Memories sent to LLM', {
        command: request.text,
        user_id: request.user_id,
        memory_ids: memories.map((m) => m.id),
        memory_types: memories.map((m) => m.type),
        memory_summaries: memories.map((m) => m.summary?.slice(0, 120)),
      });
    } catch (err) {
      console.warn('[Ghost][CommandProcessor] Failed to log memories', err);
    }

    const lowerText = request.text.toLowerCase();

    // If reminder intent detected, synthesize a concise reminder title/notes from context
    const wantsReminder = /\b(remind me|reminder|set a reminder|remember to)\b/.test(lowerText);
    let reminderHints: { title?: string; notes?: string } | undefined;
    if (wantsReminder) {
      const bestFile = memories.find((m) => m.metadata?.path);
      const baseTitle = bestFile?.metadata?.name || bestFile?.summary || request.text;
      const sanitizedTitle = (baseTitle || 'Reminder').replace(/\s+/g, ' ').trim();
      const title = sanitizedTitle.length > 80 ? `${sanitizedTitle.slice(0, 77)}...` : sanitizedTitle;

      const keyFacts = memories
        .filter((m) => m.type?.startsWith('fact'))
        .slice(0, 2)
        .map((m) => m.summary?.split(':').pop()?.trim() || m.summary || '')
        .filter(Boolean);
      const notesParts = [];
      if (bestFile?.metadata?.name) notesParts.push(`File: ${bestFile.metadata.name}`);
      if (keyFacts.length > 0) notesParts.push(`Context: ${keyFacts.join(' | ')}`);
      const notes = notesParts.join('\n').slice(0, 200);

      reminderHints = { title, notes };
    }

    // Intent guard: prefer deterministic file actions over LLM when possible
    const wantsOpen = /\b(open|view|show|display|look at|launch|navigate|go to|jump to)\b/.test(lowerText);
    const wantsScroll = /\b(scroll|scrolling|page down|page up|to the end|bottom|top)\b/.test(lowerText);
    const wantsSummarize = /\b(summarize|summary|what('|’)s in|whats in|contents|overview|outline|tl;dr)\b/.test(lowerText);
    const wantsSearch = /\b(find|search for|look for|highlight)\b/.test(lowerText);
    const wantsFileAction = wantsOpen || wantsScroll || wantsSummarize || wantsSearch;
    const wantsFileRecall =
      /\b(remind(er)?|which file|what file|which doc|what doc|what paper|supposed to read|finish reading|reminded you)\b/.test(
        lowerText
      );
    const directionHint =
      /\b(up|top|start|beginning|page up)\b/.test(lowerText) || request.scroll_direction === 'up'
        ? 'up'
        : 'down';

    if (wantsFileAction) {
      let fileMemories = memories.filter(
        (m) =>
          m &&
          m.metadata &&
          typeof m.metadata.path === 'string' &&
          m.metadata.path.length > 0
      );

      // Deduplicate by path, keep the highest score per path
      const byPath = new Map<string, any>();
      for (const f of fileMemories) {
        const key = f.metadata.path.toLowerCase();
        const existing = byPath.get(key);
        if (!existing || (f.score ?? 0) > (existing.score ?? 0)) {
          byPath.set(key, f);
        }
      }
      fileMemories = Array.from(byPath.values());

      // If none/ambiguous, try to find a file by name/path from storage
      if ((fileMemories.length === 0 || fileMemories.length > 1) && typeof (this.storageService as any).findFileByNameOrPath === 'function') {
        try {
          const matches = await (this.storageService as any).findFileByNameOrPath(request.text, request.user_id, 3);
          if (Array.isArray(matches) && matches.length > 0) {
            fileMemories = matches;
            memories = [...memories, ...matches];
          }
        } catch (err) {
          console.warn('[Ghost][CommandProcessor] findFileByNameOrPath failed', err);
        }
      }

      // If we have multiple close matches, prompt disambiguation instead of guessing
      if (fileMemories.length > 1) {
        const sorted = [...fileMemories].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
        const top = sorted[0];
        const second = sorted[1];
        const closeScores = (top?.score ?? 0) - (second?.score ?? 0) < 0.05;
        if (closeScores) {
          const options = sorted.slice(0, 3).map((m: any, idx: number) => {
            const name = m.metadata?.name || m.metadata?.path || `Option ${idx + 1}`;
            return `${idx + 1}) ${name}`;
          });
          const response: CommandResponse = {
            command_id: request.command_id,
            assistant_text: `I found multiple matching files. Which one should I use?\n${options.join('\n')}`,
            actions: [],
            memories_used: sorted.slice(0, 3),
          };
          const saved = await this.storageService.saveCommand(request, response, response.memories_used);
          if (!saved.ok) {
            return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
          }
          this.memoryService.extractFromConversation(request, response).catch((error) => {
            console.warn('Memory extraction failed:', error);
          });
          this.emit('command_processed', response);
          return { ok: true, value: response };
        }
      }

      // Scroll requires an active window/file context; bail early if none
      if (wantsScroll && !request.active_path && fileMemories.length === 0) {
        const response: CommandResponse = {
          command_id: request.command_id,
          assistant_text: 'I need an active file/window to scroll. Please focus the file first or tell me which one.',
          actions: [],
          memories_used: [],
        };
        const saved = await this.storageService.saveCommand(request, response, []);
        if (!saved.ok) {
          return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
        }
        this.emit('command_processed', response);
        return { ok: true, value: response };
      }

      // If we have at least one file path, pick best match and bypass LLM
      if (fileMemories.length >= 1) {
        const sorted = [...fileMemories].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
        const file = sorted[0];
        const actions = [];
        const activePath = request.active_path;
        const activeMatches =
          activePath &&
          file?.metadata?.path &&
          file.metadata.path.toLowerCase() === activePath.toLowerCase();

        // If the client reports we are already near the end, avoid redundant scrolling.
        const nearEnd =
          wantsScroll &&
          directionHint === 'down' &&
          typeof request.scroll_progress === 'number' &&
          request.scroll_progress >= 0.95 &&
          activeMatches;

        // Summarize / search-in-file intent
        if (wantsSummarize || wantsSearch) {
          actions.push({
            type: 'info.summarize',
            params: {
              topic: wantsSearch ? `Find: ${request.text}` : `Summary: ${request.text}`,
              sources: [file?.metadata?.path].filter(Boolean) as string[],
              format: 'brief',
            },
          });
        } else if (wantsOpen || (!activeMatches && !wantsScroll) || !file) {
          actions.push({
            type: 'file.open',
            params: {
              path: file?.metadata?.path,
            },
          });
        }

        // For scroll intents, if we already have a file match, just scroll it; avoid reopening.
        if (wantsScroll && !nearEnd) {
          actions.push({
            type: 'file.scroll',
            params: {
              direction: directionHint,
              amount: 5000, // capped to avoid runaway scroll; daemon applies its own safety limits
            },
          });
        }

        if (actions.length === 0) {
          // Should not happen, fallback to LLM path
        } else {
          const response: CommandResponse = {
            command_id: request.command_id,
            assistant_text: nearEnd
              ? `You're already near the end of the file, so I won't scroll further.`
              : wantsSummarize || wantsSearch
                ? `Working on ${wantsSearch ? 'finding that in' : 'summarizing'} the file.`
                : wantsScroll
                  ? `Scrolling ${directionHint} in the file.`
                  : `Opening the file.`,
            actions,
            memories_used: [file],
          };

          const saved = await this.storageService.saveCommand(request, response, [file]);
          if (!saved.ok) {
            return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
          }

          this.memoryService.extractFromConversation(request, response).catch((error) => {
            console.warn('Memory extraction failed:', error);
          });

          this.emit('command_processed', response);
          return { ok: true, value: response };
        }
      }
    }

    // If user is asking about "what file/paper" and we have a strong single match, offer to open it without acting
    if (!wantsFileAction && wantsFileRecall) {
      let fileMemories = memories.filter(
        (m) =>
          m &&
          m.metadata &&
          typeof m.metadata.path === 'string' &&
          m.metadata.path.length > 0
      );

      if (fileMemories.length === 0 && typeof (this.storageService as any).findFileByNameOrPath === 'function') {
        try {
          const matches = await (this.storageService as any).findFileByNameOrPath(request.text, request.user_id, 1);
          if (Array.isArray(matches) && matches.length > 0) {
            fileMemories = matches;
            memories = [...memories, ...matches];
          }
        } catch (err) {
          console.warn('[Ghost][CommandProcessor] findFileByNameOrPath failed (recall)', err);
        }
      }

      // Deduplicate by path
      const byPath = new Map<string, any>();
      for (const f of fileMemories) {
        const key = f.metadata.path.toLowerCase();
        const existing = byPath.get(key);
        if (!existing || (f.score ?? 0) > (existing.score ?? 0)) {
          byPath.set(key, f);
        }
      }
      fileMemories = Array.from(byPath.values());

      if (fileMemories.length === 1 && (fileMemories[0].score ?? 0) >= 0.4) {
        const file = fileMemories[0];
        const response: CommandResponse = {
          command_id: request.command_id,
          assistant_text: 'I found a file that matches. Want me to open it?',
          actions: [
            {
              type: 'info.recall',
              params: {
                summary: `Matched file: ${file?.metadata?.name || file?.metadata?.path || 'file'}. Say "open the file" to open it.`,
                confidence: file?.score ?? 0.4,
              },
            },
          ],
          memories_used: [file],
        };

        const saved = await this.storageService.saveCommand(request, response, [file]);
        if (!saved.ok) {
          return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
        }

        this.memoryService.extractFromConversation(request, response).catch((error) => {
          console.warn('Memory extraction failed:', error);
        });

        this.emit('command_processed', response);
        return { ok: true, value: response };
      }
    }

    // If nothing came back from context-engine, fall back to recent indexed files
    if (memories.length === 0 && typeof (this.storageService as any).getRecentFiles === 'function') {
      const fallback = (this.storageService as any).getRecentFiles(request.user_id, 6);
      if (fallback?.ok && Array.isArray(fallback.value) && fallback.value.length > 0) {
        memories = fallback.value;
      }
    }

    const llmResponse = await this.llmCoordinator.generateResponse(
      request.text,
      contextResult.context,
      memories,
      request.screen_context
    );

    const response: CommandResponse = {
      command_id: request.command_id,
      assistant_text: llmResponse.assistant_text,
      actions: llmResponse.actions,
      memories_used: memories,
    };

    const saved = await this.storageService.saveCommand(request, response, memories);
    if (!saved.ok) {
      return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
    }

    // Fire and forget memory extraction; errors are logged but not fatal
    this.memoryService.extractFromConversation(request, response).catch((error) => {
      console.warn('Memory extraction failed:', error);
    });

    this.emit('command_processed', response);
    return { ok: true, value: response };
  }

  private validate(
    request: CommandRequest
  ): Result<true, { type: 'validation_error'; message: string }> {
    if (!request.user_id) return { ok: false, error: { type: 'validation_error', message: 'user_id is required' } };
    if (!request.command_id) return { ok: false, error: { type: 'validation_error', message: 'command_id is required' } };
    if (!request.text) return { ok: false, error: { type: 'validation_error', message: 'text is required' } };
    return { ok: true, value: true };
  }
}

// Export singleton instance for backward compatibility
export const commandProcessor = new CommandProcessor();
