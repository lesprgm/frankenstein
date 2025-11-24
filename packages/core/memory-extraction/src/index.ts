/**
 * Memory Extraction Module
 * 
 * Extracts structured memories (entities, facts, decisions) from conversations
 * using LLM-based analysis.
 */

import {
  MemoryExtractorConfig,
  ExtractionOptions,
  ExtractionResult,
  BatchExtractionResult,
  NormalizedConversation,
  ExtractedMemory,
  ExtractedRelationship,
  StrategyConfig,
  ModelParams,
  MemoryTypeConfig,
  ExtractionProfile,
  RetryConfig,
  Logger,
  ChunkingMetadata,
} from './types.js';
import { Result, ExtractionError } from './errors.js';
import { MemoryDeduplicator } from './deduplicator.js';
import { MemoryValidator } from './validator.js';
import { IncrementalExtractor } from './incremental.js';
import { DEFAULT_MEMORY_TYPES } from './memory-types.js';
import { ProfileRegistry } from './profiles.js';
import { ChunkingOrchestrator } from './chunking/orchestrator.js';
import { TokenCounter } from './chunking/token-counter.js';
import { ChunkDeduplicator } from './chunking/deduplicator.js';
import { SlidingWindowStrategy } from './chunking/strategies/sliding-window.js';
import { ConversationBoundaryStrategy } from './chunking/strategies/conversation-boundary.js';
import { SemanticStrategy } from './chunking/strategies/semantic.js';
import type { ChunkingConfig, ChunkingStrategy as IChunkingStrategy } from './chunking/types.js';

/**
 * Main MemoryExtractor class for extracting memories from conversations
 */
export class MemoryExtractor {
  private config: MemoryExtractorConfig & {
    memoryTypes: string[];
    minConfidence: number;
    batchSize: number;
    retryConfig: RetryConfig;
    logger: Logger;
  };
  private deduplicator: MemoryDeduplicator;
  private validator: MemoryValidator;
  private customMemoryTypes: Map<string, MemoryTypeConfig>;
  private profileRegistry: ProfileRegistry;
  private chunkingOrchestrator?: ChunkingOrchestrator;
  private chunkDeduplicator?: ChunkDeduplicator;

  constructor(config: MemoryExtractorConfig) {
    // Set defaults for optional config values
    this.config = {
      provider: config.provider,
      strategy: config.strategy,
      memoryTypes: config.memoryTypes ?? ['entity', 'fact', 'decision'],
      minConfidence: config.minConfidence ?? 0.5,
      batchSize: config.batchSize ?? 10,
      retryConfig: config.retryConfig ?? {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
      },
      logger: config.logger ?? this.createDefaultLogger(),
      chunking: config.chunking,
    };

    this.deduplicator = new MemoryDeduplicator();
    this.validator = new MemoryValidator({
      minConfidence: this.config.minConfidence,
    });
    this.customMemoryTypes = new Map<string, MemoryTypeConfig>();
    this.profileRegistry = new ProfileRegistry();

    // Initialize chunking if enabled
    if (this.config.chunking?.enabled) {
      this.initializeChunking();
    }
  }

  /**
   * Initialize chunking orchestrator and strategies
   */
  private initializeChunking(): void {
    const tokenCounter = new TokenCounter();
    const strategies = this.loadChunkingStrategies();
    
    this.chunkingOrchestrator = new ChunkingOrchestrator(
      tokenCounter,
      strategies,
      this.config.logger
    );
    
    this.chunkDeduplicator = new ChunkDeduplicator(this.config.logger);
    
    this.config.logger.info('Chunking initialized', {
      enabled: true,
      maxTokensPerChunk: this.config.chunking?.maxTokensPerChunk ?? 100000,
      strategy: this.config.chunking?.strategy ?? 'sliding-window',
      availableStrategies: Array.from(strategies.keys()),
    });
  }

  /**
   * Load available chunking strategies
   */
  private loadChunkingStrategies(): Map<string, IChunkingStrategy> {
    const strategies = new Map<string, IChunkingStrategy>();
    
    // Create a token counter for strategies
    const tokenCounter = new TokenCounter();
    
    // Register built-in strategies
    const slidingWindow = new SlidingWindowStrategy(tokenCounter);
    const conversationBoundary = new ConversationBoundaryStrategy(tokenCounter);
    const semantic = new SemanticStrategy(tokenCounter);
    
    strategies.set(slidingWindow.name, slidingWindow);
    strategies.set(conversationBoundary.name, conversationBoundary);
    strategies.set(semantic.name, semantic);
    
    return strategies;
  }

  /**
   * Extract memories from a single conversation
   * 
   * @param conversation - The normalized conversation to extract from
   * @param workspaceId - The workspace ID to tag all memories with
   * @param options - Optional extraction options to override config
   * @returns Result containing extracted memories and relationships
   */
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    try {
      // Check if chunking is needed
      if (this.chunkingOrchestrator && this.config.chunking?.enabled) {
        const chunkingConfig = this.buildChunkingConfig();
        
        if (this.chunkingOrchestrator.needsChunking(conversation, chunkingConfig)) {
          // Route to chunked extraction
          return this.extractWithChunking(conversation, workspaceId, options);
        }
      }

      // Apply profile settings if specified
      const effectiveConfig = this.applyProfile(options);
      
      // Merge options with config (profile settings take precedence if profile was specified)
      const memoryTypes = options?.memoryTypes ?? effectiveConfig.memoryTypes;
      const minConfidence = options?.minConfidence ?? effectiveConfig.minConfidence;
      const includeRelationships = options?.includeRelationships ?? true;

      this.config.logger.info(
        `Starting extraction for conversation ${conversation.id} in workspace ${workspaceId}`
      );

      // Build strategy config (use profile's provider and strategy if available)
      const strategyConfig: StrategyConfig = {
        memoryTypes,
        memoryTypeConfigs: this.customMemoryTypes,
        provider: effectiveConfig.provider,
        modelParams: effectiveConfig.modelParams,
      };

      // Call strategy to extract raw memories (use profile's strategy if available)
      this.config.logger.debug('Calling extraction strategy', {
        strategy: effectiveConfig.strategy.name,
        memoryTypes,
      });

      const rawResult = await effectiveConfig.strategy.extract(
        conversation,
        workspaceId,
        strategyConfig
      );

      this.config.logger.debug('Raw extraction complete', {
        memoriesCount: rawResult.memories.length,
        relationshipsCount: rawResult.relationships.length,
      });

      // Process raw memories: add IDs, timestamps, and required fields
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
          workspace_id: workspaceId,
          conversation_id: conversation.id,
          source_message_ids: rawMemory.source_message_ids ?? conversation.messages.map(m => m.id),
          metadata: rawMemory.metadata ?? {},
          created_at: rawMemory.created_at ?? new Date().toISOString(),
        };

        // Validate custom memory types against their schema and validator
        const typeConfig = this.getMemoryTypeConfig(memory.type);
        if (typeConfig) {
          // Validate against schema if provided
          if (typeConfig.schema) {
            const schemaValidation = this.validateMemoryAgainstSchema(memory, typeConfig.schema);
            if (!schemaValidation.valid) {
              this.config.logger.warn(
                `Skipping memory that failed schema validation for type '${memory.type}'`,
                {
                  memoryId: memory.id,
                  errors: schemaValidation.errors,
                }
              );
              continue;
            }
          }

          // Validate with custom validator if provided
          if (typeConfig.validator) {
            try {
              const isValid = typeConfig.validator(memory);
              if (!isValid) {
                this.config.logger.warn(
                  `Skipping memory that failed custom validation for type '${memory.type}'`,
                  { memoryId: memory.id }
                );
                continue;
              }
            } catch (error) {
              this.config.logger.warn(
                `Custom validator threw error for memory type '${memory.type}'`,
                { memoryId: memory.id, error }
              );
              continue;
            }
          }
        }

        // Generate stable ID using deduplicator
        memory.id = this.deduplicator.generateMemoryId(memory);
        
        processedMemories.push(memory);
      }

      this.config.logger.debug('Memories processed', {
        count: processedMemories.length,
      });

      // Deduplicate memories
      const deduplicatedMemories = this.deduplicator.deduplicate(processedMemories);
      
      this.config.logger.debug('Deduplication complete', {
        before: processedMemories.length,
        after: deduplicatedMemories.length,
      });

      // Validate memories (use effective minConfidence from profile if applicable)
      const validator = new MemoryValidator({
        minConfidence: minConfidence,
      });
      const validationResult = validator.validateBatch(deduplicatedMemories);
      
      if (validationResult.errors.length > 0) {
        this.config.logger.warn('Validation errors found', {
          errorCount: validationResult.errors.length,
          errors: validationResult.errors,
        });
      }

      const validMemories = validationResult.validMemories;

      this.config.logger.debug('Validation complete', {
        valid: validMemories.length,
        invalid: validationResult.invalidMemories.length,
      });

      // Process relationships if requested
      let validRelationships: ExtractedRelationship[] = [];
      
      if (includeRelationships && rawResult.relationships.length > 0) {
        // Build complete relationship objects
        const processedRelationships: ExtractedRelationship[] = [];
        
        for (const rawRel of rawResult.relationships) {
          if (!rawRel.from_memory_id || !rawRel.to_memory_id || !rawRel.relationship_type) {
            this.config.logger.warn('Skipping relationship with missing required fields', {
              relationship: rawRel,
            });
            continue;
          }

          const relationship: ExtractedRelationship = {
            id: rawRel.id ?? this.generateRelationshipId(rawRel.from_memory_id, rawRel.to_memory_id, rawRel.relationship_type),
            from_memory_id: rawRel.from_memory_id,
            to_memory_id: rawRel.to_memory_id,
            relationship_type: rawRel.relationship_type,
            confidence: rawRel.confidence ?? 0.5,
            created_at: rawRel.created_at ?? new Date().toISOString(),
          };

          processedRelationships.push(relationship);
        }

        // Validate relationships
        const relationshipValidation = validator.validateRelationships(
          processedRelationships,
          validMemories
        );

        if (!relationshipValidation.valid) {
          this.config.logger.warn('Relationship validation errors', {
            errors: relationshipValidation.errors,
          });
        }

        // Filter out invalid relationships
        validRelationships = processedRelationships.filter(rel => {
          const fromExists = validMemories.some(m => m.id === rel.from_memory_id);
          const toExists = validMemories.some(m => m.id === rel.to_memory_id);
          return fromExists && toExists;
        });

        this.config.logger.debug('Relationship validation complete', {
          total: processedRelationships.length,
          valid: validRelationships.length,
        });
      }

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

      this.config.logger.info('Extraction complete', {
        conversationId: conversation.id,
        status,
        memoriesCount: validMemories.length,
        relationshipsCount: validRelationships.length,
      });

      const result: ExtractionResult = {
        memories: validMemories,
        relationships: validRelationships,
        conversationId: conversation.id,
        status,
        errors: errors.length > 0 ? errors : undefined,
      };

      return { ok: true, value: result };

    } catch (error) {
      // Determine error type and add comprehensive context
      let extractionError: ExtractionError;

      if (error instanceof Error) {
        // Check if it's an LLM error
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          this.config.logger.error('Rate limit error during extraction', {
            conversationId: conversation.id,
            workspaceId,
            provider: this.config.provider.name,
            strategy: this.config.strategy.name,
            error: error.message,
          });
          
          extractionError = {
            type: 'rate_limit',
            retryAfter: 60000, // Default to 60 seconds
          };
        } else if (error.message.includes('parse') || error.message.includes('JSON')) {
          this.config.logger.error('Parse error during extraction', {
            conversationId: conversation.id,
            workspaceId,
            provider: this.config.provider.name,
            strategy: this.config.strategy.name,
            error: error.message,
          });
          
          extractionError = {
            type: 'parse_error',
            message: `Failed to parse LLM response for conversation ${conversation.id}: ${error.message}`,
          };
        } else {
          this.config.logger.error('LLM error during extraction', {
            conversationId: conversation.id,
            workspaceId,
            provider: this.config.provider.name,
            strategy: this.config.strategy.name,
            error: error.message,
            stack: error.stack,
          });
          
          extractionError = {
            type: 'llm_error',
            provider: this.config.provider.name,
            message: `Extraction failed for conversation ${conversation.id} in workspace ${workspaceId}: ${error.message}`,
            cause: error,
          };
        }
      } else {
        this.config.logger.error('Unknown error during extraction', {
          conversationId: conversation.id,
          workspaceId,
          provider: this.config.provider.name,
          strategy: this.config.strategy.name,
          error,
        });
        
        extractionError = {
          type: 'llm_error',
          provider: this.config.provider.name,
          message: `Unknown error occurred during extraction for conversation ${conversation.id} in workspace ${workspaceId}`,
          cause: error,
        };
      }

      return { ok: false, error: extractionError };
    }
  }

  /**
   * Extract memories from a large conversation using chunking
   * 
   * @param conversation - The normalized conversation to extract from
   * @param workspaceId - The workspace ID to tag all memories with
   * @param options - Optional extraction options to override config
   * @returns Result containing extracted memories and relationships
   */
  private async extractWithChunking(
    conversation: NormalizedConversation,
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    try {
      if (!this.chunkingOrchestrator || !this.chunkDeduplicator) {
        throw new Error('Chunking not initialized');
      }

      this.config.logger.info(
        `Starting chunked extraction for conversation ${conversation.id}`,
        {
          conversationId: conversation.id,
          workspaceId,
          messageCount: conversation.messages.length,
        }
      );

      const startTime = Date.now();
      
      // Build chunking configuration
      const chunkingConfig = this.buildChunkingConfig();
      
      // Apply profile settings if specified
      const effectiveConfig = this.applyProfile(options);
      
      // Merge options with config
      const memoryTypes = options?.memoryTypes ?? effectiveConfig.memoryTypes;
      const minConfidence = options?.minConfidence ?? effectiveConfig.minConfidence;
      const includeRelationships = options?.includeRelationships ?? true;

      // Phase 1: Chunk the conversation
      const chunkingStartTime = Date.now();
      const chunks = this.chunkingOrchestrator.chunkConversation(conversation, chunkingConfig);
      const chunkingTime = Date.now() - chunkingStartTime;

      this.config.logger.info(
        `Conversation chunked into ${chunks.length} chunks`,
        {
          conversationId: conversation.id,
          chunkCount: chunks.length,
          chunkingTime,
        }
      );

      // Phase 2: Extract from each chunk sequentially
      const extractionStartTime = Date.now();
      
      // Build strategy config
      const strategyConfig: StrategyConfig = {
        memoryTypes,
        memoryTypeConfigs: this.customMemoryTypes,
        provider: effectiveConfig.provider,
        modelParams: effectiveConfig.modelParams,
      };

      const failureMode = this.config.chunking?.failureMode ?? 'continue-on-error';
      
      const chunkResults = await this.chunkingOrchestrator.processChunksSequentially(
        chunks,
        workspaceId,
        effectiveConfig.strategy,
        strategyConfig,
        failureMode
      );
      
      const extractionTime = Date.now() - extractionStartTime;

      this.config.logger.info(
        `Chunk extraction complete`,
        {
          conversationId: conversation.id,
          successfulChunks: chunkResults.filter(r => r.status === 'success').length,
          failedChunks: chunkResults.filter(r => r.status === 'failed').length,
          extractionTime,
        }
      );

      // Phase 3: Deduplicate across chunks
      const deduplicationStartTime = Date.now();
      
      const deduplicationResult = this.chunkDeduplicator.deduplicateAcrossChunks(chunkResults);
      
      this.config.logger.info(
        `Cross-chunk deduplication complete`,
        {
          conversationId: conversation.id,
          totalMemories: deduplicationResult.uniqueMemories.length,
          duplicatesFound: deduplicationResult.duplicatesFound,
        }
      );

      // Process memories: add IDs, timestamps, and required fields
      const processedMemories: ExtractedMemory[] = [];
      
      for (const rawMemory of deduplicationResult.uniqueMemories) {
        // Ensure all required fields are present
        if (!rawMemory.type || !rawMemory.content) {
          this.config.logger.warn('Skipping memory with missing required fields', {
            memory: rawMemory,
          });
          continue;
        }

        // Build complete memory object
        const memory: ExtractedMemory = {
          id: rawMemory.id || this.deduplicator.generateMemoryId(rawMemory),
          type: rawMemory.type,
          content: rawMemory.content,
          confidence: rawMemory.confidence ?? 0.5,
          workspace_id: workspaceId,
          conversation_id: conversation.id,
          source_message_ids: rawMemory.source_message_ids ?? conversation.messages.map(m => m.id),
          metadata: rawMemory.metadata ?? {},
          created_at: rawMemory.created_at ?? new Date().toISOString(),
          source_chunks: rawMemory.source_chunks,
          chunk_confidence: rawMemory.chunk_confidence,
          merged_from: rawMemory.merged_from,
        };

        // Validate custom memory types against their schema and validator
        const typeConfig = this.getMemoryTypeConfig(memory.type);
        if (typeConfig) {
          // Validate against schema if provided
          if (typeConfig.schema) {
            const schemaValidation = this.validateMemoryAgainstSchema(memory, typeConfig.schema);
            if (!schemaValidation.valid) {
              this.config.logger.warn(
                `Skipping memory that failed schema validation for type '${memory.type}'`,
                {
                  memoryId: memory.id,
                  errors: schemaValidation.errors,
                }
              );
              continue;
            }
          }

          // Validate with custom validator if provided
          if (typeConfig.validator) {
            try {
              const isValid = typeConfig.validator(memory);
              if (!isValid) {
                this.config.logger.warn(
                  `Skipping memory that failed custom validation for type '${memory.type}'`,
                  { memoryId: memory.id }
                );
                continue;
              }
            } catch (error) {
              this.config.logger.warn(
                `Custom validator threw error for memory type '${memory.type}'`,
                { memoryId: memory.id, error }
              );
              continue;
            }
          }
        }
        
        processedMemories.push(memory);
      }

      // Validate memories
      const validator = new MemoryValidator({
        minConfidence: minConfidence,
      });
      const validationResult = validator.validateBatch(processedMemories);
      
      if (validationResult.errors.length > 0) {
        this.config.logger.warn('Validation errors found', {
          errorCount: validationResult.errors.length,
          errors: validationResult.errors,
        });
      }

      const validMemories = validationResult.validMemories;

      // Process relationships if requested
      let validRelationships: ExtractedRelationship[] = [];
      
      if (includeRelationships) {
        // Collect all relationships from successful chunks
        const allRelationships: ExtractedRelationship[] = [];
        
        for (const chunkResult of chunkResults) {
          if (chunkResult.status === 'success') {
            for (const rawRel of chunkResult.relationships) {
              if (!rawRel.from_memory_id || !rawRel.to_memory_id || !rawRel.relationship_type) {
                continue;
              }

              const relationship: ExtractedRelationship = {
                id: rawRel.id ?? this.generateRelationshipId(rawRel.from_memory_id, rawRel.to_memory_id, rawRel.relationship_type),
                from_memory_id: rawRel.from_memory_id,
                to_memory_id: rawRel.to_memory_id,
                relationship_type: rawRel.relationship_type,
                confidence: rawRel.confidence ?? 0.5,
                created_at: rawRel.created_at ?? new Date().toISOString(),
              };

              allRelationships.push(relationship);
            }
          }
        }

        // Merge relationships across chunks
        const mergedRelationships = this.chunkDeduplicator.mergeRelationships(
          validMemories,
          allRelationships
        );

        // Validate relationships
        const relationshipValidation = validator.validateRelationships(
          mergedRelationships,
          validMemories
        );

        if (!relationshipValidation.valid) {
          this.config.logger.warn('Relationship validation errors', {
            errors: relationshipValidation.errors,
          });
        }

        validRelationships = mergedRelationships;

        this.config.logger.debug('Relationship processing complete', {
          total: allRelationships.length,
          merged: mergedRelationships.length,
          valid: validRelationships.length,
        });
      }

      const deduplicationTime = Date.now() - deduplicationStartTime;
      const totalTime = Date.now() - startTime;

      // Determine status
      let status: 'success' | 'partial' | 'failed';
      const errors: ExtractionError[] = [];

      // Check for chunk failures
      const failedChunks = chunkResults.filter(r => r.status === 'failed');
      
      if (validMemories.length === 0) {
        status = 'failed';
        if (failedChunks.length > 0) {
          errors.push({
            type: 'llm_error',
            provider: this.config.provider.name,
            message: `All chunks failed extraction for conversation ${conversation.id}`,
          });
        }
        if (validationResult.errors.length > 0) {
          errors.push({
            type: 'validation_error',
            errors: validationResult.errors,
          });
        }
      } else if (failedChunks.length > 0 || validationResult.invalidMemories.length > 0) {
        status = 'partial';
        if (failedChunks.length > 0) {
          errors.push({
            type: 'llm_error',
            provider: this.config.provider.name,
            message: `${failedChunks.length} of ${chunkResults.length} chunks failed extraction`,
          });
        }
        if (validationResult.errors.length > 0) {
          errors.push({
            type: 'validation_error',
            errors: validationResult.errors,
          });
        }
      } else {
        status = 'success';
      }

      // Calculate chunk size statistics
      const chunkSizes = chunks.map(c => c.tokenCount);
      const minChunkSize = Math.min(...chunkSizes);
      const maxChunkSize = Math.max(...chunkSizes);
      const avgChunkSize = chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length;

      // Calculate extraction rates
      const successfulChunks = chunkResults.filter(r => r.status === 'success');
      const avgMemoriesPerChunk = successfulChunks.length > 0
        ? successfulChunks.reduce((sum, r) => sum + r.memories.length, 0) / successfulChunks.length
        : 0;
      const avgRelationshipsPerChunk = successfulChunks.length > 0
        ? successfulChunks.reduce((sum, r) => sum + r.relationships.length, 0) / successfulChunks.length
        : 0;

      // Build chunking metadata
      const chunkingMetadata: ChunkingMetadata = {
        enabled: true,
        strategy: chunkingConfig.strategy,
        totalChunks: chunks.length,
        totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
        averageTokensPerChunk: Math.round(avgChunkSize),
        overlapTokens: chunkingConfig.overlapTokens ?? 0,
        processingTime: {
          chunking: chunkingTime,
          extraction: extractionTime,
          deduplication: deduplicationTime,
          total: totalTime,
        },
        chunkSizes: {
          min: minChunkSize,
          max: maxChunkSize,
          avg: Math.round(avgChunkSize),
        },
        extractionRate: {
          memoriesPerChunk: Math.round(avgMemoriesPerChunk * 100) / 100,
          relationshipsPerChunk: Math.round(avgRelationshipsPerChunk * 100) / 100,
        },
      };

      this.config.logger.info('Chunked extraction complete', {
        conversationId: conversation.id,
        status,
        memoriesCount: validMemories.length,
        relationshipsCount: validRelationships.length,
        chunkCount: chunks.length,
        timingBreakdown: {
          chunking: chunkingTime,
          extraction: extractionTime,
          deduplication: deduplicationTime,
          total: totalTime,
        },
      });

      const result: ExtractionResult = {
        memories: validMemories,
        relationships: validRelationships,
        conversationId: conversation.id,
        status,
        errors: errors.length > 0 ? errors : undefined,
        chunkingMetadata,
      };

      return { ok: true, value: result };

    } catch (error) {
      // Determine error type and add comprehensive context
      let extractionError: ExtractionError;

      if (error instanceof Error) {
        this.config.logger.error('Chunked extraction failed', {
          conversationId: conversation.id,
          workspaceId,
          error: error.message,
          stack: error.stack,
        });
        
        extractionError = {
          type: 'llm_error',
          provider: this.config.provider.name,
          message: `Chunked extraction failed for conversation ${conversation.id}: ${error.message}`,
          cause: error,
        };
      } else {
        this.config.logger.error('Unknown error during chunked extraction', {
          conversationId: conversation.id,
          workspaceId,
          error,
        });
        
        extractionError = {
          type: 'llm_error',
          provider: this.config.provider.name,
          message: `Unknown error occurred during chunked extraction for conversation ${conversation.id}`,
          cause: error,
        };
      }

      return { ok: false, error: extractionError };
    }
  }

  /**
   * Extract memories from multiple conversations (batch processing)
   * 
   * @param conversations - Array of normalized conversations to extract from
   * @param workspaceId - The workspace ID to tag all memories with
   * @param options - Optional extraction options to override config
   * @returns Result containing batch extraction results with per-conversation status
   */
  async extractBatch(
    conversations: NormalizedConversation[],
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<BatchExtractionResult, ExtractionError>> {
    try {
      this.config.logger.info(
        `Starting batch extraction for ${conversations.length} conversations in workspace ${workspaceId}`
      );

      const results: ExtractionResult[] = [];
      const allMemories: ExtractedMemory[] = [];
      const allRelationships: ExtractedRelationship[] = [];
      let successCount = 0;
      let failureCount = 0;

      // Process conversations in batches according to configured batch size
      const batchSize = this.config.batchSize;
      
      for (let i = 0; i < conversations.length; i += batchSize) {
        const batch = conversations.slice(i, i + batchSize);
        
        this.config.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}`, {
          batchStart: i,
          batchSize: batch.length,
        });

        // Process each conversation in the batch
        // Handle extraction failures for individual conversations without failing entire batch
        const batchPromises = batch.map(async (conversation) => {
          try {
            const result = await this.extract(conversation, workspaceId, options);
            
            if (result.ok) {
              return result.value;
            } else {
              // Extraction failed, return a failed result
              this.config.logger.warn(
                `Extraction failed for conversation ${conversation.id}`,
                { error: result.error }
              );
              
              return {
                memories: [],
                relationships: [],
                conversationId: conversation.id,
                status: 'failed' as const,
                errors: [result.error],
              };
            }
          } catch (error) {
            // Unexpected error during extraction
            this.config.logger.error(
              `Unexpected error extracting conversation ${conversation.id}`,
              { error }
            );
            
            return {
              memories: [],
              relationships: [],
              conversationId: conversation.id,
              status: 'failed' as const,
              errors: [{
                type: 'llm_error' as const,
                provider: this.config.provider.name,
                message: error instanceof Error ? error.message : 'Unknown error',
                cause: error,
              }],
            };
          }
        });

        // Wait for all extractions in this batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Collect results and memories
        for (const result of batchResults) {
          results.push(result);
          
          if (result.status === 'success' || result.status === 'partial') {
            successCount++;
            // Collect all memories from successful extractions
            allMemories.push(...result.memories);
            allRelationships.push(...result.relationships);
          } else {
            failureCount++;
          }
        }

        this.config.logger.debug(`Batch ${Math.floor(i / batchSize) + 1} complete`, {
          successCount: batchResults.filter(r => r.status !== 'failed').length,
          failureCount: batchResults.filter(r => r.status === 'failed').length,
        });
      }

      this.config.logger.info('All conversations processed', {
        total: conversations.length,
        successCount,
        failureCount,
        totalMemoriesBeforeDedup: allMemories.length,
      });

      // Use MemoryDeduplicator to deduplicate across all conversations in batch
      const deduplicatedMemories = this.deduplicator.deduplicate(allMemories);
      
      this.config.logger.info('Cross-conversation deduplication complete', {
        before: allMemories.length,
        after: deduplicatedMemories.length,
        duplicatesRemoved: allMemories.length - deduplicatedMemories.length,
      });

      // Validate all memories and relationships
      const validationResult = this.validator.validateBatch(deduplicatedMemories);
      
      if (validationResult.errors.length > 0) {
        this.config.logger.warn('Validation errors found in batch', {
          errorCount: validationResult.errors.length,
        });
      }

      const validMemories = validationResult.validMemories;

      // Validate relationships against the deduplicated and validated memories
      const relationshipValidation = this.validator.validateRelationships(
        allRelationships,
        validMemories
      );

      if (!relationshipValidation.valid) {
        this.config.logger.warn('Relationship validation errors in batch', {
          errors: relationshipValidation.errors,
        });
      }

      // Filter out invalid relationships (those referencing non-existent memories)
      const validRelationships = allRelationships.filter(rel => {
        const fromExists = validMemories.some(m => m.id === rel.from_memory_id);
        const toExists = validMemories.some(m => m.id === rel.to_memory_id);
        return fromExists && toExists;
      });

      // Deduplicate relationships
      const deduplicatedRelationships = this.deduplicateRelationships(validRelationships);

      this.config.logger.info('Batch extraction complete', {
        totalConversations: conversations.length,
        successCount,
        failureCount,
        totalMemories: validMemories.length,
        totalRelationships: deduplicatedRelationships.length,
      });

      // Return BatchExtractionResult with per-conversation status
      const batchResult: BatchExtractionResult = {
        results,
        totalMemories: validMemories.length,
        totalRelationships: deduplicatedRelationships.length,
        successCount,
        failureCount,
      };

      return { ok: true, value: batchResult };

    } catch (error) {
      // Log comprehensive error context for batch extraction failure
      this.config.logger.error('Batch extraction failed', {
        workspaceId,
        totalConversations: conversations.length,
        provider: this.config.provider.name,
        strategy: this.config.strategy.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Return error for entire batch with context
      const extractionError: ExtractionError = {
        type: 'llm_error',
        provider: this.config.provider.name,
        message: `Batch extraction failed for ${conversations.length} conversations in workspace ${workspaceId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        cause: error,
      };

      return { ok: false, error: extractionError };
    }
  }

  /**
   * Create an incremental extractor for streaming conversations
   * 
   * @param conversationId - The conversation ID to extract from
   * @param workspaceId - The workspace ID to tag all memories with
   * @param options - Optional extraction options to override config
   * @returns IncrementalExtractor instance for streaming extraction
   */
  createIncrementalExtractor(
    conversationId: string,
    workspaceId: string,
    options?: ExtractionOptions
  ): IncrementalExtractor {
    // Merge options with config if provided
    const config = {
      ...this.config,
      memoryTypes: options?.memoryTypes ?? this.config.memoryTypes,
      minConfidence: options?.minConfidence ?? this.config.minConfidence,
    } as any; // Cast to any since IncrementalExtractor doesn't use chunking
    
    // Create and return IncrementalExtractor instance with current config
    // Pass strategy and provider to incremental extractor
    return new IncrementalExtractor(
      conversationId,
      workspaceId,
      this.config.strategy,
      config
    );
  }

  /**
   * Register an extraction profile
   * 
   * @param name - The name of the profile
   * @param profile - The profile configuration
   * @throws Error if the profile name is invalid or already exists
   */
  registerProfile(name: string, profile: ExtractionProfile): void {
    this.profileRegistry.register(name, profile);
    
    this.config.logger.info(`Registered extraction profile: ${name}`, {
      strategy: profile.strategy.name,
      provider: profile.provider.name,
      memoryTypes: profile.memoryTypes,
      minConfidence: profile.minConfidence,
    });
  }

  /**
   * Register a custom memory type
   * 
   * @param type - The name of the custom memory type
   * @param config - Configuration for the custom memory type
   * @throws Error if the type name conflicts with a default type or is invalid
   */
  registerMemoryType(type: string, config: MemoryTypeConfig): void {
    // Validate type name
    if (!type || typeof type !== 'string' || type.trim().length === 0) {
      throw new Error('Memory type name must be a non-empty string');
    }

    const normalizedType = type.trim().toLowerCase();

    // Check if it conflicts with default types
    if (normalizedType in DEFAULT_MEMORY_TYPES) {
      throw new Error(
        `Cannot register custom memory type '${type}': conflicts with default type. ` +
        `Default types are: ${Object.keys(DEFAULT_MEMORY_TYPES).join(', ')}`
      );
    }

    // Validate config
    if (!config.type || config.type !== type) {
      throw new Error(
        `Memory type config.type '${config.type}' must match the registered type name '${type}'`
      );
    }

    if (!config.extractionPrompt || config.extractionPrompt.trim().length === 0) {
      throw new Error(`Memory type '${type}' must have a non-empty extractionPrompt`);
    }

    // Validate schema if provided
    if (config.schema) {
      this.validateMemoryTypeSchema(type, config.schema);
    }

    // Store custom memory type config
    this.customMemoryTypes.set(normalizedType, config);

    this.config.logger.info(`Registered custom memory type: ${type}`, {
      hasSchema: !!config.schema,
      hasValidator: !!config.validator,
    });
  }

  /**
   * Apply profile settings if specified in options
   * 
   * @param options - Extraction options that may contain a profile name
   * @returns Effective configuration with profile settings applied
   */
  private applyProfile(options?: ExtractionOptions): {
    strategy: any;
    provider: any;
    modelParams: ModelParams;
    memoryTypes: string[];
    minConfidence: number;
  } {
    // If no profile specified, return current config
    if (!options?.profile) {
      return {
        strategy: this.config.strategy,
        provider: this.config.provider,
        modelParams: this.getModelParams(),
        memoryTypes: this.config.memoryTypes,
        minConfidence: this.config.minConfidence,
      };
    }

    // Get profile from registry
    const profile = this.profileRegistry.get(options.profile);
    
    if (!profile) {
      this.config.logger.warn(
        `Profile '${options.profile}' not found, using default config`
      );
      return {
        strategy: this.config.strategy,
        provider: this.config.provider,
        modelParams: this.getModelParams(),
        memoryTypes: this.config.memoryTypes,
        minConfidence: this.config.minConfidence,
      };
    }

    // Apply profile settings
    this.config.logger.debug(`Applying profile: ${options.profile}`, {
      strategy: profile.strategy.name,
      provider: profile.provider.name,
      memoryTypes: profile.memoryTypes,
      minConfidence: profile.minConfidence,
    });

    return {
      strategy: profile.strategy,
      provider: profile.provider,
      modelParams: profile.modelParams,
      memoryTypes: profile.memoryTypes,
      minConfidence: profile.minConfidence,
    };
  }

  /**
   * Get memory type configuration (checks custom types first, then defaults)
   * 
   * @param type - The memory type name
   * @returns The memory type configuration, or undefined if not found
   */
  private getMemoryTypeConfig(type: string): MemoryTypeConfig | undefined {
    const normalizedType = type.toLowerCase();
    
    // Check custom types first
    if (this.customMemoryTypes.has(normalizedType)) {
      return this.customMemoryTypes.get(normalizedType);
    }
    
    // Fall back to default types
    return DEFAULT_MEMORY_TYPES[normalizedType];
  }

  /**
   * Get all configured memory types (default + custom)
   * 
   * @returns Array of all available memory type names
   */
  private getAllMemoryTypes(): string[] {
    const defaultTypes = Object.keys(DEFAULT_MEMORY_TYPES);
    const customTypes = Array.from(this.customMemoryTypes.keys());
    return [...defaultTypes, ...customTypes];
  }

  /**
   * Validate a memory type schema
   * 
   * @param type - The memory type name
   * @param schema - The JSON schema to validate
   * @throws Error if the schema is invalid
   */
  private validateMemoryTypeSchema(type: string, schema: any): void {
    if (!schema || typeof schema !== 'object') {
      throw new Error(`Memory type '${type}' schema must be an object`);
    }

    if (!schema.type) {
      throw new Error(`Memory type '${type}' schema must have a 'type' field`);
    }

    if (schema.type === 'object' && !schema.properties) {
      throw new Error(
        `Memory type '${type}' schema with type 'object' must have a 'properties' field`
      );
    }

    // Basic validation passed
  }

  /**
   * Validate a memory's metadata against a JSON schema
   * 
   * @param memory - The memory to validate
   * @param schema - The JSON schema to validate against
   * @returns Validation result with any errors
   */
  private validateMemoryAgainstSchema(
    memory: ExtractedMemory,
    schema: any
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Only validate if schema is for an object (metadata validation)
    if (schema.type !== 'object') {
      return { valid: true, errors: [] };
    }

    const metadata = memory.metadata || {};

    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in metadata)) {
          errors.push(`Missing required field in metadata: ${requiredField}`);
        }
      }
    }

    // Validate field types if properties are defined
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        if (fieldName in metadata) {
          const value = metadata[fieldName];
          const fieldSchemaObj = fieldSchema as any;

          // Basic type checking
          if (fieldSchemaObj.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            const expectedType = fieldSchemaObj.type;

            if (actualType !== expectedType) {
              errors.push(
                `Field '${fieldName}' has type '${actualType}' but expected '${expectedType}'`
              );
            }

            // Validate enum values if specified
            if (fieldSchemaObj.enum && Array.isArray(fieldSchemaObj.enum)) {
              if (!fieldSchemaObj.enum.includes(value)) {
                errors.push(
                  `Field '${fieldName}' has value '${value}' which is not in allowed values: ${fieldSchemaObj.enum.join(', ')}`
                );
              }
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Deduplicate relationships by ID
   */
  private deduplicateRelationships(relationships: ExtractedRelationship[]): ExtractedRelationship[] {
    const seen = new Map<string, ExtractedRelationship>();
    
    for (const rel of relationships) {
      if (!seen.has(rel.id)) {
        seen.set(rel.id, rel);
      } else {
        // If duplicate, keep the one with higher confidence
        const existing = seen.get(rel.id)!;
        if (rel.confidence > existing.confidence) {
          seen.set(rel.id, rel);
        }
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Build chunking configuration from config
   */
  private buildChunkingConfig(): ChunkingConfig {
    const chunkingConfig = this.config.chunking!;
    
    // Set sensible defaults
    const maxTokensPerChunk = chunkingConfig.maxTokensPerChunk ?? 100000;
    const overlapPercentage = chunkingConfig.overlapPercentage ?? 0.1;
    const overlapTokens = chunkingConfig.overlapTokens ?? Math.floor(maxTokensPerChunk * overlapPercentage);
    const minChunkSize = Math.floor(maxTokensPerChunk * 0.2); // 20% of max
    
    return {
      maxTokensPerChunk,
      overlapTokens,
      overlapPercentage,
      minChunkSize,
      strategy: chunkingConfig.strategy ?? 'sliding-window',
      preserveMessageBoundaries: true,
      tokenCountMethod: chunkingConfig.tokenCountMethod ?? 'approximate',
      customStrategyName: chunkingConfig.customStrategyName,
    };
  }

  /**
   * Get model parameters for LLM calls
   */
  private getModelParams(): ModelParams {
    // Try to infer model from provider name
    let defaultModel = 'gpt-4o-mini'; // OpenAI default
    
    if (this.config.provider.name === 'gemini') {
      defaultModel = 'gemini-3-pro-preview';
    } else if (this.config.provider.name === 'anthropic') {
      defaultModel = 'claude-3-sonnet-20240229';
    }
    
    return {
      model: defaultModel,
      temperature: 0.1,
      maxTokens: 4000,
    };
  }

  /**
   * Generate a deterministic ID for a relationship in UUID format
   */
  private generateRelationshipId(fromId: string, toId: string, type: string): string {
    const input = `${fromId}:${type}:${toId}`;
    const hash = this.simpleHash(input);
    // Pad hash to 32 chars and convert to UUID format
    const padded = hash.padEnd(32, '0');
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
  }

  /**
   * Simple hash function for generating IDs (returns hex string)
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex string for UUID compatibility
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Create a default console logger
   */
  private createDefaultLogger() {
    return {
      debug: (message: string, ...args: any[]) => {
        // Silent by default
      },
      info: (message: string, ...args: any[]) => {
        console.log(`[INFO] ${message}`, ...args);
      },
      warn: (message: string, ...args: any[]) => {
        console.warn(`[WARN] ${message}`, ...args);
      },
      error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
      },
    };
  }
}

// Re-export types and utilities
export * from './types.js';
export * from './errors.js';
export { LLMProvider } from './providers/base.js';
export { OpenAIProvider, OpenAIProviderConfig } from './providers/openai.js';
export { GeminiProvider, GeminiProviderConfig } from './providers/gemini.js';
export type { ExtractionStrategy, StrategyConfig, RawExtractionResult } from './strategies/base.js';
export { StructuredOutputStrategy, ChunkContext, createChunkSummary } from './strategies/structured.js';
export { MemoryValidator, ValidatorConfig } from './validator.js';
export { MemoryDeduplicator } from './deduplicator.js';
export { 
  DEFAULT_MEMORY_TYPES, 
  getMemoryTypeConfig, 
  getDefaultMemoryTypes, 
  isDefaultMemoryType 
} from './memory-types.js';
export { IncrementalExtractor } from './incremental.js';
export { ProfileRegistry } from './profiles.js';

// Re-export chunking functionality
export { ChunkingOrchestrator } from './chunking/orchestrator.js';
export { TokenCounter } from './chunking/token-counter.js';
export type {
  ChunkingConfig,
  ChunkingStrategy,
  ConversationChunk,
  ChunkMetadata,
  ChunkExtractionResult,
  ChunkedExtractionResult,
  ChunkingTimingBreakdown,
  ChunkingMetadata,
} from './chunking/types.js';
export type { TokenCountMethod, TokenCountResult } from './chunking/token-counter.js';

// Re-export chunking strategies
export { SlidingWindowStrategy } from './chunking/strategies/sliding-window.js';
export { ConversationBoundaryStrategy } from './chunking/strategies/conversation-boundary.js';
export { SemanticStrategy } from './chunking/strategies/semantic.js';
