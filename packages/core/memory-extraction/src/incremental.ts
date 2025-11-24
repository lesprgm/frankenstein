/**
 * Incremental memory extraction for streaming conversations
 * 
 * Supports extracting memories as new messages arrive, maintaining stable IDs
 * and merging duplicate memories across message chunks.
 */

import { EventEmitter } from 'events';
import {
  ExtractionStrategy,
  StrategyConfig,
  MemoryExtractorConfig,
  NormalizedMessage,
  ExtractedMemory,
  ExtractedRelationship,
  ExtractionResult,
  IncrementalResult,
  IncrementalState,
  IncrementalContext,
  ModelParams,
} from './types.js';
import { Result, ExtractionError } from './errors.js';
import { MemoryDeduplicator } from './deduplicator.js';
import { MemoryValidator } from './validator.js';

/**
 * IncrementalExtractor for streaming conversation memory extraction
 * 
 * Maintains state across multiple addMessages() calls and provides
 * stable memory IDs using MemoryDeduplicator.
 */
export class IncrementalExtractor extends EventEmitter {
  private conversationId: string;
  private workspaceId: string;
  private strategy: ExtractionStrategy;
  private config: Required<MemoryExtractorConfig>;
  private deduplicator: MemoryDeduplicator;
  private validator: MemoryValidator;
  
  // State tracking
  private messageHistory: NormalizedMessage[] = [];
  private existingMemories: Map<string, ExtractedMemory> = new Map();
  private existingRelationships: Map<string, ExtractedRelationship> = new Map();
  private isFinalized: boolean = false;

  constructor(
    conversationId: string,
    workspaceId: string,
    strategy: ExtractionStrategy,
    config: Required<MemoryExtractorConfig>
  ) {
    super();
    
    this.conversationId = conversationId;
    this.workspaceId = workspaceId;
    this.strategy = strategy;
    this.config = config;
    
    this.deduplicator = new MemoryDeduplicator();
    this.validator = new MemoryValidator({
      minConfidence: config.minConfidence,
    });
  }

  /**
   * Add new messages and trigger extraction
   * 
   * Accumulates messages and extracts memories incrementally, maintaining
   * stable IDs and merging with existing memories.
   */
  async addMessages(
    messages: NormalizedMessage[]
  ): Promise<Result<IncrementalResult, ExtractionError>> {
    if (this.isFinalized) {
      return {
        ok: false,
        error: {
          type: 'configuration_error',
          message: 'Cannot add messages to finalized extractor',
        },
      };
    }

    try {
      this.config.logger.debug('Adding messages to incremental extractor', {
        conversationId: this.conversationId,
        newMessageCount: messages.length,
        totalMessageCount: this.messageHistory.length + messages.length,
      });

      // Add messages to history
      this.messageHistory.push(...messages);

      // Build incremental context
      const context: IncrementalContext = {
        conversationId: this.conversationId,
        workspaceId: this.workspaceId,
        existingMemories: Array.from(this.existingMemories.values()),
        messageHistory: this.messageHistory,
      };

      // Build strategy config
      const strategyConfig: StrategyConfig = {
        memoryTypes: this.config.memoryTypes,
        provider: this.config.provider,
        modelParams: this.getModelParams(),
      };

      // Call strategy to extract from new messages
      this.config.logger.debug('Calling extractIncremental', {
        strategy: this.strategy.name,
        messageCount: messages.length,
      });

      const rawResult = await this.strategy.extractIncremental(messages, context);

      this.config.logger.debug('Raw incremental extraction complete', {
        memoriesCount: rawResult.memories.length,
        relationshipsCount: rawResult.relationships.length,
      });

      // Process raw memories
      const processedMemories: ExtractedMemory[] = [];
      
      for (const rawMemory of rawResult.memories) {
        // Ensure all required fields are present
        if (!rawMemory.type || !rawMemory.content) {
          this.config.logger.warn('Skipping memory with missing required fields', {
            memory: rawMemory,
          });
          continue;
        }

        // Build complete memory object
        const memory: ExtractedMemory = {
          id: '', // Will be set by deduplicator
          type: rawMemory.type,
          content: rawMemory.content,
          confidence: rawMemory.confidence ?? 0.5,
          workspace_id: this.workspaceId,
          conversation_id: this.conversationId,
          source_message_ids: rawMemory.source_message_ids ?? messages.map(m => m.id),
          metadata: rawMemory.metadata ?? {},
          created_at: rawMemory.created_at ?? new Date().toISOString(),
        };

        // Use MemoryDeduplicator.generateMemoryId() for stable IDs
        memory.id = this.deduplicator.generateMemoryId(memory);
        
        processedMemories.push(memory);
      }

      // Track new and updated memories
      const newMemories: ExtractedMemory[] = [];
      const updatedMemories: ExtractedMemory[] = [];

      for (const memory of processedMemories) {
        if (this.existingMemories.has(memory.id)) {
          // Memory already exists - merge with existing
          const existing = this.existingMemories.get(memory.id)!;
          const merged = this.deduplicator.merge([existing, memory]);
          
          this.existingMemories.set(memory.id, merged);
          updatedMemories.push(merged);
          
          this.config.logger.debug('Updated existing memory', {
            memoryId: memory.id,
            type: memory.type,
          });
        } else {
          // New memory
          this.existingMemories.set(memory.id, memory);
          newMemories.push(memory);
          
          this.config.logger.debug('Added new memory', {
            memoryId: memory.id,
            type: memory.type,
          });
          
          // Emit 'memory' event for new memories
          this.emit('memory', memory);
        }
      }

      // Process relationships
      const newRelationships: ExtractedRelationship[] = [];
      
      for (const rawRel of rawResult.relationships) {
        if (!rawRel.from_memory_id || !rawRel.to_memory_id || !rawRel.relationship_type) {
          this.config.logger.warn('Skipping relationship with missing required fields', {
            relationship: rawRel,
          });
          continue;
        }

        const relationship: ExtractedRelationship = {
          id: rawRel.id ?? this.generateRelationshipId(
            rawRel.from_memory_id,
            rawRel.to_memory_id,
            rawRel.relationship_type
          ),
          from_memory_id: rawRel.from_memory_id,
          to_memory_id: rawRel.to_memory_id,
          relationship_type: rawRel.relationship_type,
          confidence: rawRel.confidence ?? 0.5,
          created_at: rawRel.created_at ?? new Date().toISOString(),
        };

        // Check if relationship already exists
        if (!this.existingRelationships.has(relationship.id)) {
          this.existingRelationships.set(relationship.id, relationship);
          newRelationships.push(relationship);
          
          this.config.logger.debug('Added new relationship', {
            relationshipId: relationship.id,
            type: relationship.relationship_type,
          });
          
          // Emit 'relationship' event for new relationships
          this.emit('relationship', relationship);
        }
      }

      this.config.logger.info('Incremental extraction complete', {
        conversationId: this.conversationId,
        newMemories: newMemories.length,
        updatedMemories: updatedMemories.length,
        newRelationships: newRelationships.length,
        totalMemories: this.existingMemories.size,
        totalRelationships: this.existingRelationships.size,
      });

      const result: IncrementalResult = {
        newMemories,
        updatedMemories,
        newRelationships,
      };

      return { ok: true, value: result };

    } catch (error) {
      // Determine error type and add comprehensive context
      let extractionError: ExtractionError;

      if (error instanceof Error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          this.config.logger.error('Rate limit error during incremental extraction', {
            conversationId: this.conversationId,
            workspaceId: this.workspaceId,
            messageCount: messages.length,
            totalMessages: this.messageHistory.length,
            provider: this.config.provider.name,
            strategy: this.strategy.name,
            error: error.message,
          });
          
          extractionError = {
            type: 'rate_limit',
            retryAfter: 60000,
          };
        } else if (error.message.includes('parse') || error.message.includes('JSON')) {
          this.config.logger.error('Parse error during incremental extraction', {
            conversationId: this.conversationId,
            workspaceId: this.workspaceId,
            messageCount: messages.length,
            totalMessages: this.messageHistory.length,
            provider: this.config.provider.name,
            strategy: this.strategy.name,
            error: error.message,
          });
          
          extractionError = {
            type: 'parse_error',
            message: `Failed to parse LLM response for incremental extraction (conversation ${this.conversationId}): ${error.message}`,
          };
        } else {
          this.config.logger.error('LLM error during incremental extraction', {
            conversationId: this.conversationId,
            workspaceId: this.workspaceId,
            messageCount: messages.length,
            totalMessages: this.messageHistory.length,
            existingMemories: this.existingMemories.size,
            provider: this.config.provider.name,
            strategy: this.strategy.name,
            error: error.message,
            stack: error.stack,
          });
          
          extractionError = {
            type: 'llm_error',
            provider: this.config.provider.name,
            message: `Incremental extraction failed for conversation ${this.conversationId} in workspace ${this.workspaceId}: ${error.message}`,
            cause: error,
          };
        }
      } else {
        this.config.logger.error('Unknown error during incremental extraction', {
          conversationId: this.conversationId,
          workspaceId: this.workspaceId,
          messageCount: messages.length,
          totalMessages: this.messageHistory.length,
          provider: this.config.provider.name,
          strategy: this.strategy.name,
          error,
        });
        
        extractionError = {
          type: 'llm_error',
          provider: this.config.provider.name,
          message: `Unknown error occurred during incremental extraction for conversation ${this.conversationId} in workspace ${this.workspaceId}`,
          cause: error,
        };
      }

      return { ok: false, error: extractionError };
    }
  }

  /**
   * Finalize extraction and create final ExtractionResult
   * 
   * Validates all memories and relationships, filters by confidence threshold,
   * and returns the complete extraction result.
   */
  async finalize(): Promise<Result<ExtractionResult, ExtractionError>> {
    if (this.isFinalized) {
      return {
        ok: false,
        error: {
          type: 'configuration_error',
          message: 'Extractor already finalized',
        },
      };
    }

    try {
      this.config.logger.info('Finalizing incremental extraction', {
        conversationId: this.conversationId,
        totalMemories: this.existingMemories.size,
        totalRelationships: this.existingRelationships.size,
      });

      // Get all memories and relationships
      const allMemories = Array.from(this.existingMemories.values());
      const allRelationships = Array.from(this.existingRelationships.values());

      // Validate all memories
      const validationResult = this.validator.validateBatch(allMemories);
      
      if (validationResult.errors.length > 0) {
        this.config.logger.warn('Validation errors found during finalization', {
          errorCount: validationResult.errors.length,
          errors: validationResult.errors,
        });
      }

      const validMemories = validationResult.validMemories;

      this.config.logger.debug('Memory validation complete', {
        valid: validMemories.length,
        invalid: validationResult.invalidMemories.length,
      });

      // Validate relationships
      const relationshipValidation = this.validator.validateRelationships(
        allRelationships,
        validMemories
      );

      if (!relationshipValidation.valid) {
        this.config.logger.warn('Relationship validation errors during finalization', {
          errors: relationshipValidation.errors,
        });
      }

      // Filter out invalid relationships
      const validRelationships = allRelationships.filter(rel => {
        const fromExists = validMemories.some(m => m.id === rel.from_memory_id);
        const toExists = validMemories.some(m => m.id === rel.to_memory_id);
        return fromExists && toExists;
      });

      this.config.logger.debug('Relationship validation complete', {
        total: allRelationships.length,
        valid: validRelationships.length,
      });

      // Determine status
      let status: 'success' | 'partial' | 'failed';
      const errors: ExtractionError[] = [];

      if (validMemories.length === 0) {
        status = 'failed';
        if (validationResult.errors.length > 0) {
          errors.push({
            type: 'validation_error',
            errors: validationResult.errors,
          });
        }
      } else if (validationResult.invalidMemories.length > 0) {
        status = 'partial';
        if (validationResult.errors.length > 0) {
          errors.push({
            type: 'validation_error',
            errors: validationResult.errors,
          });
        }
      } else {
        status = 'success';
      }

      // Mark as finalized
      this.isFinalized = true;

      this.config.logger.info('Incremental extraction finalized', {
        conversationId: this.conversationId,
        status,
        memoriesCount: validMemories.length,
        relationshipsCount: validRelationships.length,
      });

      const result: ExtractionResult = {
        memories: validMemories,
        relationships: validRelationships,
        conversationId: this.conversationId,
        status,
        errors: errors.length > 0 ? errors : undefined,
      };

      return { ok: true, value: result };

    } catch (error) {
      // Log comprehensive error context for finalization failure
      this.config.logger.error('Finalization failed', {
        conversationId: this.conversationId,
        workspaceId: this.workspaceId,
        totalMessages: this.messageHistory.length,
        totalMemories: this.existingMemories.size,
        totalRelationships: this.existingRelationships.size,
        provider: this.config.provider.name,
        strategy: this.strategy.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const extractionError: ExtractionError = {
        type: 'llm_error',
        provider: this.config.provider.name,
        message: `Finalization failed for conversation ${this.conversationId} in workspace ${this.workspaceId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        cause: error,
      };

      return { ok: false, error: extractionError };
    }
  }

  /**
   * Get current extraction state
   * 
   * Returns information about the current state of the incremental extraction.
   */
  getState(): IncrementalState {
    return {
      conversationId: this.conversationId,
      workspaceId: this.workspaceId,
      messageCount: this.messageHistory.length,
      memoryCount: this.existingMemories.size,
      isFinalized: this.isFinalized,
    };
  }

  /**
   * Get model parameters for LLM calls
   */
  private getModelParams(): ModelParams {
    return {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 4000,
    };
  }

  /**
   * Generate a deterministic ID for a relationship in UUID format
   */
  private generateRelationshipId(fromId: string, toId: string, type: string): string {
    const crypto = require('crypto');
    const input = `${fromId}:${type}:${toId}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    // Convert to UUID format (8-4-4-4-12)
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }
}
