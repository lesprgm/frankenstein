import type { ContextResult, MemoryReference } from '../types.js';
import type { MemoryLayerIntegration } from './memory-layer-integration.js';
import { memoryLayerIntegration as defaultMemoryLayerIntegration } from './memory-layer-integration.js';

const DEFAULT_MEMORY_LIMIT = 6;

/**
 * Context builder that uses MemoryLayer's context-engine for semantic search
 */
export class ContextBuilder {
  private memoryLayerIntegration: MemoryLayerIntegration;

  /**
   * Create a new ContextBuilder instance
   * 
   * @param memoryLayerIntegration - Optional MemoryLayerIntegration instance (defaults to singleton)
   */
  constructor(memoryLayerIntegration?: MemoryLayerIntegration) {
    this.memoryLayerIntegration = memoryLayerIntegration || defaultMemoryLayerIntegration;
  }

  /**
   * Build context using semantic search via context-engine
   * 
   * @param commandText - User's command text
   * @param userId - User ID for workspace scoping
   * @returns Context result with formatted context and memories
   */
  async buildContext(commandText: string, userId: string): Promise<ContextResult> {
    // Ensure MemoryLayer is initialized
    if (!this.memoryLayerIntegration.isInitialized()) {
      await this.memoryLayerIntegration.initialize();
    }

    const contextEngine = this.memoryLayerIntegration.contextEngine;

    if (!contextEngine) {
      console.warn('ContextEngine not available, using fallback');
      return this.buildFallbackContext(commandText);
    }

    try {
      // Use context-engine for semantic search and context building
      // For Ghost's simple model, userId == workspaceId
      const workspaceId = userId;

      const contextResult = await contextEngine.buildContext(commandText, workspaceId, {
        limit: DEFAULT_MEMORY_LIMIT,
        includeRelationships: true,
        relationshipDepth: 2,
        tokenBudget: 4000,
        template: 'concise',
        minConfidence: 0.4, // Tune threshold for better recall
      });

      if (!contextResult.ok) {
        console.error('Context building failed:', contextResult.error);
        return this.buildFallbackContext(commandText);
      }

      const converted = contextResult.value.memories.map(result => ({
        memory: this.convertToMemoryReference(result.memory, result.score),
        score: result.score,
      }));

      console.log('[ContextBuilder] Raw memories from ContextEngine:', converted.map(m => ({
        type: m.memory.type,
        score: m.score,
        summary: m.memory.summary.substring(0, 80)
      })));

      // Filter out conversational echoes (fact.command/response)
      let memories = converted.filter((entry) => !this.isConversationMemory(entry.memory.type));

      console.log('[ContextBuilder] After conversation filter:', memories.length);

      // Boost fact-type memories to prioritize content over metadata
      memories = memories.map(entry => {
        if (entry.memory.type === 'fact') {
          // Boost content-based memories

          return {
            ...entry,
            score: entry.score * 1.5 // Boost by 50%
          };
        }
        return entry;
      });

      // Re-sort by score after boosting
      memories.sort((a, b) => b.score - a.score);

      // If we still have screen context and other memories, drop the screen context; otherwise keep it
      const withoutScreens = memories.filter((entry) => !entry.memory.type.startsWith('context.screen'));
      if (withoutScreens.length > 0) {
        memories = withoutScreens;
      }

      console.log('[ContextBuilder] Final memories for LLM:', memories.map(m => ({
        type: m.memory.type,
        score: m.score,
        summary: m.memory.summary.substring(0, 80)
      })));

      // Convert to Ghost's ContextResult format
      return {
        context: contextResult.value.context,
        memories,
      };
    } catch (error) {
      console.error('Error building context:', error);
      return this.buildFallbackContext(commandText);
    }
  }

  /**
   * Simple fallback context when semantic search is unavailable
   */
  private buildFallbackContext(commandText: string): ContextResult {
    const sanitizedText = this.redactPII(commandText);

    const context = [
      'You are Ghost, a concise AI assistant.',
      'No context memories available.',
      '',
      `User: ${sanitizedText}`,
    ].join('\n');

    return {
      context,
      memories: [],
    };
  }

  /**
   * Convert MemoryLayer Memory to Ghost MemoryReference
   */
  private convertToMemoryReference(memory: any, score = 1): MemoryReference {
    const rawMeta = memory.metadata || memory.meta;
    let metadata: Record<string, any> | undefined = rawMeta;
    if (typeof rawMeta === 'string') {
      try {
        metadata = JSON.parse(rawMeta);
      } catch {
        metadata = undefined;
      }
    }

    return {
      id: memory.id,
      type: memory.type,
      summary: memory.content || memory.summary,
      score,
      metadata,
    };
  }

  private isConversationMemory(type: string): boolean {
    return type.startsWith('fact.response') || type.startsWith('fact.command');
  }

  /**
   * Redact simple PII like emails and file paths
   */
  private redactPII(text: string): string {
    const emailRedacted = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
    return emailRedacted.replace(/\/[^\s]+/g, '[path]');
  }
}

// Export singleton instance for backward compatibility
export const contextBuilder = new ContextBuilder();
