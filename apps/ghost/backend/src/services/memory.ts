import type { CommandRequest, CommandResponse, MemoryReference, Result } from '../types.js';
import { storageService } from './storage.js';
import { makerConfig, makerReliableExtractMemory, type MakerExtractedMemory } from '@memorylayer/memory-extraction';
import { geminiMakerProvider } from './gemini-maker-provider.js';

/**
 * MemoryService wires together MemoryLayer primitives with the in-memory store.
 * For the MVP we use lightweight heuristics while keeping the interface future-compatible.
 * 
 * Now enhanced with MAKER-inspired reliability layer for session memory extraction.
 */
export class MemoryService {
  constructor(private store: typeof storageService = storageService) { }

  /**
   * Build context memories for a command using simple similarity search.
   */
  async getContextMemories(commandText: string, userId: string): Promise<MemoryReference[]> {
    const result = await this.store.searchMemories(commandText, userId, 8);
    if (!result.ok) {
      return [];
    }
    return result.value.map((entry) => entry.memory);
  }

  /**
   * Extract memories from a command/response pair.
   * 
   * Enhanced with MAKER reliability layer for session-level memories:
   * - Runs parallel microagents for consensus
   * - Red-flags malformed/hallucinated outputs
   * - Uses voting for error correction
   */
  async extractFromConversation(
    request: CommandRequest,
    response: CommandResponse
  ): Promise<Result<MemoryReference[], { type: 'extraction_error'; message: string }>> {
    try {
      const recallSummary = response.actions.find((action) => action.type === 'info.recall')?.params as any;
      const assistantSummary = typeof recallSummary?.summary === 'string' && recallSummary.summary.trim().length > 0
        ? recallSummary.summary.trim()
        : response.assistant_text;

      const memories: MemoryReference[] = [
        {
          id: `mem-${request.command_id}-user`,
          type: 'fact.command',
          score: 0.9,
          summary: `User asked: ${request.text}`,
          metadata: { command_id: request.command_id },
        },
        {
          id: `mem-${request.command_id}-assistant`,
          type: 'fact.response',
          score: 0.85,
          summary: `Assistant: ${assistantSummary}`,
          metadata: { command_id: request.command_id },
        },
      ];

      // MAKER-enhanced extraction for session-level memories
      if (makerConfig.enabled) {
        try {
          const sourceText = `User: ${request.text}\nAssistant: ${assistantSummary}`;
          const extracted = await makerReliableExtractMemory(sourceText, geminiMakerProvider);

          if (extracted) {
            // Add MAKER-extracted session memory with higher confidence
            memories.push({
              id: `mem-${request.command_id}-session`,
              type: 'fact.session',
              score: 0.95,  // Higher confidence due to MAKER validation
              summary: extracted.summary,
              metadata: {
                command_id: request.command_id,
                extraction_method: 'maker',
                decisions: extracted.decisions,
                todos: extracted.todos,
                maker_verified: true,
              },
            });

            console.log('[MemoryService] MAKER extracted session memory', {
              command_id: request.command_id,
              decisions_count: extracted.decisions.length,
              todos_count: extracted.todos.length,
            });
          } else {
            console.warn('[MemoryService] MAKER extraction returned null, using standard extraction only');
          }
        } catch (error) {
          console.warn('[MemoryService] MAKER extraction failed, falling back to standard extraction', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Attach any file-related actions as memories for later recall
      response.actions.forEach((action, index) => {
        if (action.type === 'file.open' && 'path' in action.params) {
          memories.push({
            id: `mem-${request.command_id}-action-${index}`,
            type: 'entity.file',
            score: 0.82,
            summary: `Opened file at ${action.params.path}`,
            metadata: { path: action.params.path },
          });
        }
      });

      this.store.addMemories(
        memories.map((mem) => ({
          ...mem,
          createdAt: new Date().toISOString(),
          workspace_id: request.user_id,
          source: 'command',
        }))
      );

      return { ok: true, value: memories };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'extraction_error', message: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

export const memoryService = new MemoryService();
