import type { Action, CommandRequest, CommandResponse, LLMResponse, MemoryReference, ProcessError, ReminderCreateParams, Result } from '../types.js';
import type { ContextBuilder } from './context-builder.js';
import type { LLMCoordinator } from './llm-coordinator.js';
import type { MemoryService } from './memory.js';
import type { SQLiteStorage } from './sqlite-storage.js';
import { ExplainabilityService } from './explainability-service.js';
import { contextBuilder as defaultContextBuilder } from './context-builder.js';
import { llmCoordinator as defaultLlmCoordinator } from './llm-coordinator.js';
import { memoryService as defaultMemoryService } from './memory.js';
import { storageService as defaultStorageService } from './storage.js';
import type { WorkflowEngine } from './workflow-engine.js';
import { workflowEngine as defaultWorkflowEngine } from './workflow-engine.js';
import { buildOpenFileAmbiguity, saveOpenChoices, type PendingChoice } from './workflows/file-open-ambiguity.js';

import { EventEmitter } from 'node:events';

const DEFAULT_ROUTING_CHAT = 'llm-first';
const DEFAULT_ROUTING_ACTION = 'deterministic-first';
const CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const RISKY_ACTION_TYPES = new Set(['file.open', 'system.open', 'system.type']);

type PendingActionMetadata = {
  actions?: Action[];
  memories_used?: MemoryReference[];
  choices?: PendingChoice[];
  default_index?: number;
};

/**
 * Main entry point for processing a command request end-to-end.
 * Supports dependency injection for better testability.
 */
export class CommandProcessor extends EventEmitter {
  private contextBuilder: ContextBuilder;
  private llmCoordinator: LLMCoordinator;
  private memoryService: MemoryService;
  private storageService: SQLiteStorage;
  private explainabilityService: ExplainabilityService;
  private workflowEngine: WorkflowEngine;

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
    storageService?: SQLiteStorage,
    workflowEngine?: WorkflowEngine
  ) {
    super();
    this.contextBuilder = contextBuilder || defaultContextBuilder;
    this.llmCoordinator = llmCoordinator || defaultLlmCoordinator;
    this.memoryService = memoryService || defaultMemoryService;
    this.storageService = storageService || defaultStorageService;
    this.workflowEngine = workflowEngine || defaultWorkflowEngine;
    
    // Initialize explainability service with the underlying DB
    // Note: storageService.db is private, but we can access it via getHealth() or assume it's available
    // For now, we'll try to grab it from the storage service if possible, or rely on the global instance
    const health = this.storageService.getHealth();
    if (health.ok && (health.value as any).db) {
        this.explainabilityService = new ExplainabilityService((health.value as any).db);
    } else {
        // Fallback or no-op if DB not accessible
        console.warn('[Ghost] ExplainabilityService could not be initialized (no DB access)');
        this.explainabilityService = { storeExplanation: async () => {} } as any;
    }
  }

  async process(request: CommandRequest): Promise<Result<CommandResponse, ProcessError>> {
    const validation = this.validate(request);
    if (!validation.ok) {
      return validation;
    }

    const pendingResult = await this.maybeHandlePendingConfirmation(request);
    if (pendingResult) {
      return pendingResult;
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

    // Inject conversation history if in conversational mode (Sliding Window)
    if (request.conversational_mode) {
      try {
        const history = this.storageService.getRecentConversationTurns(request.user_id);
        if (history.length > 0) {
          console.info(`[Ghost] Injecting ${history.length} conversation turns`);
          memories = [...history, ...memories];
        }
      } catch (err) {
        console.warn('[Ghost] Failed to fetch conversation history', err);
      }
    }

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
              !m.type?.startsWith('fact.response') &&
              !m.type?.startsWith('fact.pending_action')
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
          !m.type.startsWith('fact.response') &&
          !m.type.startsWith('fact.pending_action')
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
        !m.type.startsWith('fact.response') &&
        !m.type.startsWith('fact.pending_action')
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
        !m.type.startsWith('fact.response') &&
        !m.type.startsWith('fact.pending_action')
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
            !m.type?.startsWith('fact.response') &&
            !m.type?.startsWith('fact.pending_action')
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
        !m.type.startsWith('fact.response') &&
        !m.type.startsWith('fact.pending_action')
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
    const allowDeterministicActions = this.getRoutingMode(request) === 'deterministic-first';

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

    if (allowDeterministicActions && wantsFileAction) {
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
        if (closeScores && !wantsSummarize && !wantsSearch) {
          const topChoices = sorted.slice(0, 3);
          const options = topChoices.map((m: any, idx: number) => {
            const name = m.metadata?.name || m.metadata?.path || `Option ${idx + 1}`;
            return `${idx + 1}) ${name}`;
          });
          const response: CommandResponse = {
            command_id: request.command_id,
            assistant_text: `I found multiple matching files. Which one should I use?\n${options.join('\n')}`,
            actions: [],
            memories_used: topChoices,
          };
          const choices: PendingChoice[] = topChoices.map((memory: any) => ({
            action: { type: 'file.open', params: { path: memory.metadata?.path } },
            memories_used: [memory],
            label: memory.metadata?.name || memory.metadata?.path || memory.summary,
          }));
          await saveOpenChoices(this.storageService, request, {
            confirmation: response,
            choices,
            defaultIndex: 0,
          });
          return await this.saveAndEmit(request, response, response.memories_used);
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

        // Summarize / search intents are routed to the LLM so the user gets actual output.
        if (!wantsSummarize && !wantsSearch) {
          if (wantsOpen || (!activeMatches && !wantsScroll) || !file) {
            actions.push({
              type: 'file.open',
              params: {
                path: file?.metadata?.path,
              },
            });
          }
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
          // Fall through to LLM handling (summary/search or no deterministic action).
        } else {
          const response: CommandResponse = {
            command_id: request.command_id,
            assistant_text: nearEnd
              ? `You're already near the end of the file, so I won't scroll further.`
              : wantsScroll
                ? `Scrolling ${directionHint} in the file.`
                : `Opening the file.`,
            actions,
            memories_used: [file],
          };
          return await this.finalizeResponse(request, response, [file]);
        }
      }
    }

    // If user is asking about "what file/paper" and we have a strong single match, offer to open it without acting
    if (allowDeterministicActions && !wantsFileAction && wantsFileRecall) {
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
      request.screen_context,
      request.conversational_mode,
      request.system_context,
      request.command_id
    );

    const actionsWithHints = this.applyReminderHints(llmResponse.actions || [], reminderHints);
    const normalizedActions = this.applyActionDefaults(actionsWithHints, memories);
    const normalizedLlm: LLMResponse = { ...llmResponse, actions: normalizedActions };

    const workflowResponse = await this.workflowEngine.maybeHandle(
      request,
      normalizedLlm,
      memories,
      this.storageService
    );
    if (workflowResponse) {
      return await this.finalizeResponse(request, workflowResponse, workflowResponse.memories_used);
    }

    const openAmbiguity = buildOpenFileAmbiguity(request, normalizedLlm, memories);
    if (openAmbiguity) {
      await saveOpenChoices(this.storageService, request, openAmbiguity);
      return await this.saveAndEmit(
        request,
        openAmbiguity.confirmation,
        openAmbiguity.confirmation.memories_used
      );
    }

    const response: CommandResponse = {
      command_id: request.command_id,
      assistant_text: llmResponse.assistant_text,
      actions: normalizedActions,
      memories_used: memories,
    };

    return await this.finalizeResponse(request, response, memories);
  }

  private getRoutingMode(request: CommandRequest): 'llm-first' | 'deterministic-first' {
    const raw = request.conversational_mode
      ? process.env.GHOST_ROUTING_CHAT
      : process.env.GHOST_ROUTING_ACTION;
    const fallback = request.conversational_mode ? DEFAULT_ROUTING_CHAT : DEFAULT_ROUTING_ACTION;
    const normalized = (raw || fallback).toLowerCase();
    if (normalized.startsWith('llm')) return 'llm-first';
    if (normalized.startsWith('det')) return 'deterministic-first';
    if (normalized.includes('heur')) return 'deterministic-first';
    if (normalized.includes('action')) return 'deterministic-first';
    return fallback as 'llm-first' | 'deterministic-first';
  }

  private parseConfirmationIntent(text: string): 'confirm' | 'deny' | null {
    const lower = text.toLowerCase().trim();
    if (!lower) return null;
    if (/\b(no|nope|nah|cancel|stop|never mind|don't|do not)\b/.test(lower)) return 'deny';
    if (/\b(yes|yep|yeah|sure|ok|okay|confirm|do it|go ahead|please)\b/.test(lower)) return 'confirm';
    return null;
  }

  private parseChoiceIndex(text: string, maxChoices: number): number | null {
    if (maxChoices <= 0) return null;
    const lower = text.toLowerCase().trim();
    if (!lower) return null;

    const digitMatch = lower.match(/\b([1-9])\b/);
    if (digitMatch) {
      const idx = Number.parseInt(digitMatch[1], 10) - 1;
      if (idx >= 0 && idx < maxChoices) return idx;
    }

    const ordinalMatchers: Array<{ re: RegExp; index: number }> = [
      { re: /\b(first|1st|one)\b/, index: 0 },
      { re: /\b(second|2nd|two)\b/, index: 1 },
      { re: /\b(third|3rd|three)\b/, index: 2 },
    ];

    for (const matcher of ordinalMatchers) {
      if (matcher.index < maxChoices && matcher.re.test(lower)) {
        return matcher.index;
      }
    }

    return null;
  }

  private applyActionDefaults(actions: Action[], memories: MemoryReference[]): Action[] {
    return actions.map((action) => {
      const normalized: Action = { ...action };
      if (normalized.confidence === undefined) {
        normalized.confidence = this.computeActionConfidence(normalized, memories);
      }
      if (normalized.requires_confirmation === undefined) {
        normalized.requires_confirmation = this.requiresConfirmation(normalized);
      }
      return normalized;
    });
  }

  private applyReminderHints(
    actions: Action[],
    reminderHints?: { title?: string; notes?: string }
  ): Action[] {
    if (!reminderHints) return actions;

    return actions.map((action) => {
      if (action.type !== 'reminder.create') return action;

      const params = action.params as ReminderCreateParams;
      const existingTitle = typeof params.title === 'string' ? params.title.trim() : '';
      const existingNotes = typeof params.notes === 'string' ? params.notes.trim() : '';

      const nextParams: ReminderCreateParams = { ...params };

      if ((!existingTitle || existingTitle.toLowerCase() === 'reminder') && reminderHints.title) {
        nextParams.title = reminderHints.title;
      }

      if (!existingNotes && reminderHints.notes) {
        nextParams.notes = reminderHints.notes;
      }

      return { ...action, params: nextParams };
    });
  }

  private computeActionConfidence(action: Action, memories: MemoryReference[]): number {
    if (action.type === 'file.open') {
      const rawPath = typeof (action as any).params?.path === 'string' ? (action as any).params.path : '';
      if (!rawPath) return 0.2;
      const lowerPath = rawPath.toLowerCase();
      const matchesMemory = memories.some((m) => m.metadata?.path?.toLowerCase() === lowerPath);
      if (matchesMemory) return 0.9;
      const looksExplicit =
        /[\\/]/.test(rawPath) ||
        rawPath.startsWith('~') ||
        /\.[A-Za-z0-9]{2,5}$/.test(rawPath);
      return looksExplicit ? 0.7 : 0.4;
    }
    if (action.type === 'system.open') {
      const target = String((action as any).params?.target || '').toLowerCase();
      if (target.includes('://') || target.startsWith('http')) return 0.7;
      return 0.4;
    }
    if (action.type === 'system.type') {
      const text = String((action as any).params?.text || '');
      return text.length > 0 ? 0.6 : 0.2;
    }
    return 0.5;
  }

  private requiresConfirmation(action: Action): boolean {
    if (action.requires_confirmation === false) return false;
    if (action.requires_confirmation === true) return true;
    return RISKY_ACTION_TYPES.has(action.type);
  }

  private buildConfirmationPrompt(actions: Action[], memories: MemoryReference[]): string {
    const risky = actions.filter((action) => this.requiresConfirmation(action));
    if (risky.length === 0) return 'Want me to proceed?';
    const descriptors = risky.map((action) => this.describeActionForConfirmation(action, memories));
    if (descriptors.length === 1) {
      return `Want me to ${descriptors[0]}?`;
    }
    if (descriptors.length === 2) {
      return `Want me to ${descriptors[0]} and ${descriptors[1]}?`;
    }
    return `Want me to ${descriptors[0]} and ${descriptors.length - 1} other actions?`;
  }

  private describeActionForConfirmation(action: Action, memories: MemoryReference[]): string {
    if (action.type === 'file.open') {
      return `open ${this.describeFileTarget(action, memories)}`;
    }
    if (action.type === 'system.open') {
      return `open ${this.describeSystemTarget(action)}`;
    }
    if (action.type === 'system.type') {
      return 'type that text in the current app';
    }
    return 'perform that action';
  }

  private describeFileTarget(action: Action, memories: MemoryReference[]): string {
    const rawPath = typeof (action as any).params?.path === 'string' ? (action as any).params.path : '';
    if (!rawPath) return 'that file';
    const lowerPath = rawPath.toLowerCase();
    const matched = memories.find((m) => m.metadata?.path?.toLowerCase() === lowerPath);
    const name = matched?.metadata?.name || rawPath.split(/[\\/]/).pop() || rawPath;
    return name || 'that file';
  }

  private describeSystemTarget(action: Action): string {
    const target = String((action as any).params?.target || '').trim();
    if (!target) return 'that target';
    try {
      if (target.includes('://')) {
        const withoutProto = target.split('://')[1] || target;
        return withoutProto.split('/')[0] || target;
      }
    } catch {
      // ignore parsing errors
    }
    return target;
  }

  private getAssistantTextForAction(action: Action): string | null {
    if (action.type === 'info.recall') {
      const summary = (action.params as any)?.summary;
      if (typeof summary === 'string' && summary.trim().length > 0) {
        return summary.trim();
      }
    }
    return null;
  }

  private async maybeHandlePendingConfirmation(
    request: CommandRequest
  ): Promise<Result<CommandResponse, ProcessError> | null> {
    if (typeof (this.storageService as any).getRecentPendingAction !== 'function') {
      return null;
    }
    const pending = (this.storageService as any).getRecentPendingAction(
      request.user_id,
      CONFIRMATION_TTL_MS
    ) as { id: string; metadata?: PendingActionMetadata } | null;
    if (!pending) return null;

    const metadata = pending.metadata || {};
    const choices = Array.isArray(metadata.choices) ? metadata.choices : [];
    const choiceIndex = choices.length > 0 ? this.parseChoiceIndex(request.text, choices.length) : null;
    const decision = this.parseConfirmationIntent(request.text);

    if (choiceIndex === null && !decision) return null;

    if (typeof (this.storageService as any).clearPendingAction === 'function') {
      await (this.storageService as any).clearPendingAction(pending.id);
    }

    if (choiceIndex !== null) {
      const choice = choices[choiceIndex];
      if (choice?.action) {
        const memoriesUsed = choice.memories_used || metadata.memories_used || [];
        const normalizedActions = this.applyActionDefaults([choice.action], memoriesUsed).map((action) => ({
          ...action,
          requires_confirmation: false,
        }));
        const assistantText = this.getAssistantTextForAction(choice.action) || 'Got it. Proceeding now.';

        const response: CommandResponse = {
          command_id: request.command_id,
          assistant_text: assistantText,
          actions: normalizedActions,
          memories_used: memoriesUsed,
        };
        return await this.saveAndEmit(request, response, memoriesUsed);
      }
    }

    if (decision === 'deny') {
      const response: CommandResponse = {
        command_id: request.command_id,
        assistant_text: 'Okay, canceled.',
        actions: [],
        memories_used: [],
      };
      return await this.saveAndEmit(request, response, []);
    }

    if (decision === 'confirm') {
      if (choices.length > 0) {
        const defaultIndex =
          typeof metadata.default_index === 'number' ? metadata.default_index : 0;
        const choice = choices[Math.min(Math.max(defaultIndex, 0), choices.length - 1)] || choices[0];
        if (choice?.action) {
          const memoriesUsed = choice.memories_used || metadata.memories_used || [];
          const normalizedActions = this.applyActionDefaults([choice.action], memoriesUsed).map((action) => ({
            ...action,
            requires_confirmation: false,
          }));
          const assistantText = this.getAssistantTextForAction(choice.action) || 'Got it. Proceeding now.';
          const response: CommandResponse = {
            command_id: request.command_id,
            assistant_text: assistantText,
            actions: normalizedActions,
            memories_used: memoriesUsed,
          };
          return await this.saveAndEmit(request, response, memoriesUsed);
        }
      }

      const actions = Array.isArray(metadata.actions) ? metadata.actions : [];
      const memoriesUsed = Array.isArray(metadata.memories_used) ? metadata.memories_used : [];
      const normalizedActions = this.applyActionDefaults(actions, memoriesUsed).map((action) => ({
        ...action,
        requires_confirmation: false,
      }));
      const recallAction = actions.find((action) => action.type === 'info.recall');
      const assistantText =
        (recallAction && this.getAssistantTextForAction(recallAction)) || 'Got it. Proceeding now.';

      const response: CommandResponse = {
        command_id: request.command_id,
        assistant_text: assistantText,
        actions: normalizedActions,
        memories_used: memoriesUsed,
      };
      return await this.saveAndEmit(request, response, memoriesUsed);
    }

    return null;
  }

  private async maybeRequireConfirmation(
    request: CommandRequest,
    response: CommandResponse,
    memoriesUsed: MemoryReference[]
  ): Promise<CommandResponse | null> {
    const actions = response.actions || [];
    const needsConfirmation = actions.some((action) => this.requiresConfirmation(action));
    if (!needsConfirmation) return null;

    if (typeof (this.storageService as any).savePendingAction === 'function') {
      const pendingActions = actions.map((action) => ({
        ...action,
        requires_confirmation: false,
      }));
      await (this.storageService as any).savePendingAction(
        request.user_id,
        pendingActions,
        memoriesUsed,
        request.command_id
      );
    }

    return {
      command_id: request.command_id,
      assistant_text: this.buildConfirmationPrompt(actions, memoriesUsed),
      actions: [],
      memories_used: memoriesUsed,
    };
  }

  private async finalizeResponse(
    request: CommandRequest,
    response: CommandResponse,
    memoriesUsed: MemoryReference[]
  ): Promise<Result<CommandResponse, ProcessError>> {
    const normalizedActions = this.applyActionDefaults(response.actions || [], memoriesUsed);
    const normalizedResponse: CommandResponse = {
      ...response,
      actions: normalizedActions,
      memories_used: memoriesUsed,
    };

    const confirmation = await this.maybeRequireConfirmation(request, normalizedResponse, memoriesUsed);
    if (confirmation) {
      return await this.saveAndEmit(request, confirmation, confirmation.memories_used);
    }

    return await this.saveAndEmit(request, normalizedResponse, memoriesUsed);
  }

  private async saveAndEmit(
    request: CommandRequest,
    response: CommandResponse,
    memoriesUsed: MemoryReference[]
  ): Promise<Result<CommandResponse, ProcessError>> {
    const saved = await this.storageService.saveCommand(request, response, memoriesUsed);
    if (!saved.ok) {
      return { ok: false, error: { type: 'storage_error', message: saved.error.message } };
    }

    if (request.conversational_mode) {
      this.storageService.saveConversationTurn(
        request.user_id,
        request.text,
        response.assistant_text
      ).catch(err => console.warn('[Ghost] Failed to save conversation turn', err));
    }

    this.explainabilityService.storeExplanation({
      commandId: request.command_id,
      commandText: response.assistant_text,
      userQuery: request.text,
      memories: memoriesUsed,
      createdAt: new Date().toISOString(),
      reasoning: {
        query: request.text,
        steps: response.actions.map((a, i) => ({
          step: i + 1,
          action: a.type,
          description: JSON.stringify(a.params),
          timestamp: new Date().toISOString()
        })),
        retrievedCount: memoriesUsed.length,
        topMatches: memoriesUsed.slice(0, 3).map(m => ({
          memoryId: m.id,
          score: m.score || 0,
          summary: m.summary || (m as any).content?.slice(0, 50)
        }))
      },
      graph: {
        nodes: [
          { id: 'query', type: 'query', label: request.text },
          ...memoriesUsed.map(m => ({
            id: m.id,
            type: m.type.startsWith('entity.file') ? 'file' : 'memory' as any,
            label: m.summary || (m as any).content?.slice(0, 30),
            confidence: m.score
          }))
        ],
        edges: memoriesUsed.map(m => ({
          source: 'query',
          target: m.id,
          weight: m.score || 0.5,
          type: 'similarity'
        }))
      }
    }).catch(err => console.warn('[Ghost] Failed to store explanation', err));

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
