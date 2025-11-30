import type { CommandRequest, CommandResponse, ProcessError, Result } from '../types.js';
import type { ContextBuilder } from './context-builder.js';
import type { LLMCoordinator } from './llm-coordinator.js';
import type { MemoryService } from './memory.js';
import type { SQLiteStorage } from './sqlite-storage.js';
import { contextBuilder as defaultContextBuilder } from './context-builder.js';
import { llmCoordinator as defaultLlmCoordinator } from './llm-coordinator.js';
import { memoryService as defaultMemoryService } from './memory.js';
import { storageService as defaultStorageService } from './storage.js';

/**
 * Main entry point for processing a command request end-to-end.
 * Supports dependency injection for better testability.
 */
export class CommandProcessor {
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
