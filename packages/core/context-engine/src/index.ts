/**
 * Context Engine - Semantic search and context formatting for AI prompts
 */

import type {
  ContextEngineConfig,
  SearchOptions,
  ContextOptions,
  SearchResult,
  RelatedMemory,
  ContextResult,
  ContextPreview,
  ContextTemplate,
  RankingFunction,
  RankingOptions,
  Logger,
  StorageClient,
  EmbeddingProvider,
} from './types';
import type { ContextError, Result } from './errors';
import type { MemoryType } from '@memorylayer/storage';
import { EmbeddingCache, ResultCache, ContextCache } from './embeddings/cache';
import { DEFAULT_TEMPLATES } from './templates';
import { MemoryRanker } from './ranker';
import { ContextFormatter } from './formatter';
import { CharacterTokenizer } from './tokenizer';

/**
 * Default logger that does nothing
 */
const noopLogger: Logger = {
  info: () => { },
  warn: () => { },
  error: () => { },
  debug: () => { },
};

/**
 * Sanitize query text for logging (truncate and remove sensitive patterns)
 */
function sanitizeForLogging(text: string, maxLength: number = 100): string {
  if (!text) return '';

  // Truncate to max length
  let sanitized = text.substring(0, maxLength);

  // Add ellipsis if truncated
  if (text.length > maxLength) {
    sanitized += '...';
  }

  return sanitized;
}

/**
 * Sanitize error for logging (remove stack traces and internal details)
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * ContextEngine provides semantic search over memories and formats relevant context for AI prompts.
 * 
 * It combines vector search (via Storage Layer), ranking, filtering, and template-based formatting
 * to inject the right memories into conversations.
 */
export class ContextEngine {
  private readonly storageClient: StorageClient;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly embeddingCache: EmbeddingCache;
  private readonly resultCache: ResultCache;
  private readonly contextCache: ContextCache;
  private readonly defaultTemplate: string;
  private readonly defaultTokenBudget: number;
  private readonly logger: Logger;
  private readonly templates: Map<string, ContextTemplate>;
  private readonly rankers: Map<string, RankingFunction>;
  private readonly formatter: ContextFormatter;

  /**
   * Create a new ContextEngine instance
   * 
   * @param config - Configuration for the context engine
   * @throws Error if embeddingProvider.dimensions doesn't match expectedEmbeddingDimensions
   */
  constructor(config: ContextEngineConfig) {
    // Validate required configuration
    if (!config.storageClient) {
      throw new Error('storageClient is required');
    }
    if (!config.embeddingProvider) {
      throw new Error('embeddingProvider is required');
    }

    // Validate embedding dimensions if expectedEmbeddingDimensions is provided
    if (
      config.expectedEmbeddingDimensions !== undefined &&
      config.embeddingProvider.dimensions !== config.expectedEmbeddingDimensions
    ) {
      throw new Error(
        `Embedding provider dimensions (${config.embeddingProvider.dimensions}) ` +
        `do not match expected dimensions (${config.expectedEmbeddingDimensions})`
      );
    }

    // Validate embedding dimensions are positive
    if (config.embeddingProvider.dimensions <= 0) {
      throw new Error(
        `Invalid embedding dimensions: ${config.embeddingProvider.dimensions}. Must be positive.`
      );
    }

    // Validate default token budget if provided
    if (config.defaultTokenBudget !== undefined && config.defaultTokenBudget <= 0) {
      throw new Error(
        `Invalid default token budget: ${config.defaultTokenBudget}. Must be positive.`
      );
    }

    // Store core dependencies
    this.storageClient = config.storageClient;
    this.embeddingProvider = config.embeddingProvider;
    this.logger = config.logger ?? noopLogger;

    // Initialize caches
    this.embeddingCache = new EmbeddingCache(config.cacheConfig ?? {});
    this.resultCache = new ResultCache(config.cacheConfig ?? {});
    this.contextCache = new ContextCache(config.cacheConfig ?? {});

    // Set defaults
    this.defaultTemplate = config.defaultTemplate ?? 'chat';
    this.defaultTokenBudget = config.defaultTokenBudget ?? 2000;

    // Validate default template exists
    if (!DEFAULT_TEMPLATES[this.defaultTemplate]) {
      throw new Error(
        `Invalid default template: ${this.defaultTemplate}. ` +
        `Available templates: ${Object.keys(DEFAULT_TEMPLATES).join(', ')}`
      );
    }

    // Initialize template registry with default templates
    this.templates = new Map();
    for (const [name, template] of Object.entries(DEFAULT_TEMPLATES)) {
      this.templates.set(name, template);
    }

    // Initialize ranker registry with default rankers
    this.rankers = new Map();
    this.rankers.set('default', MemoryRanker.defaultRanking);
    this.rankers.set('similarity', MemoryRanker.bySimilarity);
    this.rankers.set('recency', MemoryRanker.byRecency);
    this.rankers.set('confidence', MemoryRanker.byConfidence);

    // Initialize formatter with a character-based tokenizer as default
    // Users can provide a better tokenizer via config if needed
    this.formatter = new ContextFormatter(new CharacterTokenizer());

    this.logger.info('ContextEngine initialized', {
      embeddingModel: this.embeddingProvider.model,
      embeddingDimensions: this.embeddingProvider.dimensions,
      defaultTemplate: this.defaultTemplate,
      defaultTokenBudget: this.defaultTokenBudget,
    });

    // Validate default ranking weights if provided in config (assuming config might have them in future)
    // For now, we just ensure the ranker registry is healthy
    if (this.rankers.size === 0) {
      this.logger.warn('No rankers registered');
    }
  }

  /**
   * Register a custom context template
   * 
   * @param name - Template name
   * @param template - Template configuration
   * @throws Error if template name conflicts with default templates or is invalid
   */
  registerTemplate(name: string, template: ContextTemplate): void {
    // Validate template name
    if (!name || !name.trim()) {
      throw new Error('Template name cannot be empty');
    }

    // Validate that name doesn't conflict with default templates
    const defaultTemplateNames = ['chat', 'detailed', 'summary'];
    if (defaultTemplateNames.includes(name)) {
      throw new Error(
        `Cannot register template "${name}": name conflicts with default template. ` +
        `Default templates: ${defaultTemplateNames.join(', ')}`
      );
    }

    // Validate template structure
    if (!template.memoryFormat || !template.memoryFormat.trim()) {
      throw new Error('Template memoryFormat cannot be empty');
    }

    if (template.separator === undefined) {
      throw new Error('Template separator is required');
    }

    this.templates.set(name, template);
    this.logger.debug('Registered custom template', { name });
  }

  /**
   * Register a custom ranking function
   * 
   * @param name - Ranker name
   * @param ranker - Ranking function
   * @throws Error if ranker name conflicts with default rankers or is invalid
   */
  registerRanker(name: string, ranker: RankingFunction): void {
    // Validate ranker name
    if (!name || !name.trim()) {
      throw new Error('Ranker name cannot be empty');
    }

    // Validate ranker is a function
    if (typeof ranker !== 'function') {
      throw new Error('Ranker must be a function');
    }

    // Validate that name doesn't conflict with default rankers
    const defaultRankerNames = ['default', 'similarity', 'recency', 'confidence'];
    if (defaultRankerNames.includes(name)) {
      throw new Error(
        `Cannot register ranker "${name}": name conflicts with default ranker. ` +
        `Default rankers: ${defaultRankerNames.join(', ')}`
      );
    }

    this.rankers.set(name, ranker);
    this.logger.debug('Registered custom ranker', { name });
  }

  /**
   * Internal search method that performs vector search via Storage Layer
   * 
   * @param vector - Query embedding vector
   * @param workspaceId - Workspace ID for scoping
   * @param options - Search options for filtering
   * @returns Result with search results or error
   */
  private async searchInternal(
    vector: number[],
    workspaceId: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], ContextError>> {
    try {
      // Build search query for Storage Layer
      const searchQuery: {
        vector: number[];
        limit?: number;
        types?: MemoryType[];
        dateFrom?: Date;
        dateTo?: Date;
      } = {
        vector,
        limit: options?.limit ?? 10,
      };

      // Apply filters
      if (options?.memoryTypes && options.memoryTypes.length > 0) {
        searchQuery.types = options.memoryTypes;
      }

      if (options?.dateFrom) {
        searchQuery.dateFrom = options.dateFrom;
      }

      if (options?.dateTo) {
        searchQuery.dateTo = options.dateTo;
      }

      this.logger.debug('Performing vector search', {
        workspaceId: sanitizeForLogging(workspaceId, 50),
        limit: searchQuery.limit,
        types: searchQuery.types,
        vectorDimensions: vector.length,
      });

      // Call Storage Layer searchMemories with workspace scoping
      const storageResult = await this.storageClient.searchMemories(workspaceId, searchQuery);

      if (!storageResult.ok) {
        this.logger.error('Storage Layer search failed', {
          workspaceId: sanitizeForLogging(workspaceId, 50),
          error: sanitizeError(storageResult.error),
        });
        return {
          ok: false,
          error: {
            type: 'storage_error',
            message: 'Failed to search memories in storage layer',
            cause: storageResult.error,
          },
        };
      }

      let results: SearchResult[] = storageResult.value.map((result) => ({
        memory: result.memory,
        score: result.score,
      }));

      // Apply additional filters that Storage Layer doesn't handle
      if (options?.minConfidence !== undefined) {
        results = results.filter((result) => result.memory.confidence >= options.minConfidence!);
      }

      if (options?.conversationId) {
        results = results.filter(
          (result) => result.memory.conversation_id === options.conversationId
        );
      }

      // Relationship expansion if requested
      if (options?.includeRelationships) {
        const relationshipDepth = options.relationshipDepth ?? 1;

        // Validate relationship depth
        if (relationshipDepth < 1 || relationshipDepth > 10) {
          this.logger.warn('Invalid relationship depth, using default', {
            requested: relationshipDepth,
            default: 1,
          });
        }

        const validDepth = Math.max(1, Math.min(10, relationshipDepth));

        this.logger.debug('Expanding relationships', {
          workspaceId: sanitizeForLogging(workspaceId, 50),
          depth: validDepth,
          initialResultCount: results.length,
        });

        results = await this.expandRelationships(results, workspaceId, validDepth);

        this.logger.debug('Relationship expansion completed', {
          workspaceId: sanitizeForLogging(workspaceId, 50),
          finalResultCount: results.length,
        });
      }

      this.logger.info('Search completed successfully', {
        workspaceId: sanitizeForLogging(workspaceId, 50),
        resultCount: results.length,
      });

      return { ok: true, value: results };
    } catch (error) {
      this.logger.error('Unexpected error during search', {
        workspaceId: sanitizeForLogging(workspaceId, 50),
        error: sanitizeError(error),
      });
      return {
        ok: false,
        error: {
          type: 'search_error',
          message: 'An unexpected error occurred during search operation',
          cause: error,
        },
      };
    }
  }

  /**
   * Expand relationships for search results
   * 
   * Fetches related memories up to the specified depth and deduplicates.
   * 
   * @param results - Initial search results
   * @param workspaceId - Workspace ID for scoping
   * @param maxDepth - Maximum relationship depth to follow
   * @returns Search results with relationships populated
   */
  private async expandRelationships(
    results: SearchResult[],
    workspaceId: string,
    maxDepth: number
  ): Promise<SearchResult[]> {
    // Track all memory IDs we've seen to avoid duplicates
    const seenMemoryIds = new Set<string>(results.map((r) => r.memory.id));

    // Process each result and expand its relationships
    for (const result of results) {
      const relatedMemories = await this.fetchRelatedMemories(
        result.memory.id,
        workspaceId,
        maxDepth,
        seenMemoryIds
      );

      // Add related memories to the result
      if (relatedMemories.length > 0) {
        result.relationships = relatedMemories;
      }
    }

    return results;
  }

  /**
   * Recursively fetch related memories up to a specified depth
   * 
   * @param memoryId - Starting memory ID
   * @param workspaceId - Workspace ID for scoping
   * @param maxDepth - Maximum depth to traverse
   * @param seenMemoryIds - Set of already seen memory IDs for deduplication
   * @param currentDepth - Current traversal depth (default: 1)
   * @returns Array of related memories with relationship information
   */
  private async fetchRelatedMemories(
    memoryId: string,
    workspaceId: string,
    maxDepth: number,
    seenMemoryIds: Set<string>,
    currentDepth: number = 1
  ): Promise<RelatedMemory[]> {
    // Stop if we've reached max depth
    if (currentDepth > maxDepth) {
      return [];
    }

    try {
      // Fetch relationships for this memory
      const relationshipsResult = await this.storageClient.getMemoryRelationships(
        memoryId,
        workspaceId
      );

      if (!relationshipsResult.ok) {
        this.logger.warn('Failed to fetch relationships', {
          memoryId: sanitizeForLogging(memoryId, 50),
          workspaceId: sanitizeForLogging(workspaceId, 50),
          error: sanitizeError(relationshipsResult.error),
        });
        return [];
      }

      const relationships = relationshipsResult.value;

      // 1. Identify unique targets to fetch (Optimistic Deduplication)
      const targetsToFetch: { id: string; relationship: any }[] = [];

      for (const relationship of relationships) {
        const relatedMemoryId =
          relationship.from_memory_id === memoryId
            ? relationship.to_memory_id
            : relationship.from_memory_id;

        if (!seenMemoryIds.has(relatedMemoryId)) {
          seenMemoryIds.add(relatedMemoryId);
          targetsToFetch.push({ id: relatedMemoryId, relationship });
        }
      }

      // 2. Fetch all identified memories in parallel
      const fetchPromises = targetsToFetch.map(async ({ id, relationship }) => {
        const memoryResult = await this.storageClient.getMemory(id, workspaceId);

        if (!memoryResult.ok) {
          this.logger.warn('Failed to fetch related memory', {
            memoryId: sanitizeForLogging(id, 50),
            workspaceId: sanitizeForLogging(workspaceId, 50),
            error: sanitizeError(memoryResult.error),
          });
          return null;
        }

        const relatedMemory = memoryResult.value;
        if (!relatedMemory) {
          this.logger.warn('Related memory not found', {
            memoryId: sanitizeForLogging(id, 50),
            workspaceId: sanitizeForLogging(workspaceId, 50),
          });
          return null;
        }

        return {
          memory: relatedMemory,
          relationship,
          depth: currentDepth,
        } as RelatedMemory;
      });

      const fetchedResults = await Promise.all(fetchPromises);
      const validMemories = fetchedResults.filter((r): r is RelatedMemory => r !== null);

      // 3. Recursively fetch deeper relationships in parallel
      if (currentDepth < maxDepth && validMemories.length > 0) {
        const recursivePromises = validMemories.map(item =>
          this.fetchRelatedMemories(
            item.memory.id,
            workspaceId,
            maxDepth,
            seenMemoryIds,
            currentDepth + 1
          )
        );

        const nestedResults = await Promise.all(recursivePromises);

        // Flatten nested results into our list
        for (const nested of nestedResults) {
          validMemories.push(...nested);
        }
      }

      return validMemories;

    } catch (error) {
      this.logger.error('Unexpected error fetching related memories', {
        memoryId: sanitizeForLogging(memoryId, 50),
        workspaceId: sanitizeForLogging(workspaceId, 50),
        error: sanitizeError(error),
      });
      return [];
    }
  }

  /**
   * Search memories by text query
   * 
   * Generates an embedding for the query text and performs vector search.
   * 
   * @param query - Text query to search for
   * @param workspaceId - Workspace ID for scoping
   * @param options - Search options for filtering
   * @returns Result with search results or error
   */
  async search(
    query: string,
    workspaceId: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], ContextError>> {
    // Validate inputs
    if (!query || !query.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'Query text is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      // Check embedding cache
      const cacheKey = this.embeddingCache.generateKey(query.trim(), this.embeddingProvider.model);
      let vector = this.embeddingCache.get(cacheKey);

      if (vector) {
        this.logger.debug('Using cached embedding', {
          query: sanitizeForLogging(query, 50),
          model: this.embeddingProvider.model,
        });
      } else {
        // Generate embedding
        this.logger.debug('Generating embedding for query', {
          query: sanitizeForLogging(query, 50),
          model: this.embeddingProvider.model,
        });

        try {
          vector = await this.embeddingProvider.embed(query.trim());

          // Validate embedding dimensions
          if (vector.length !== this.embeddingProvider.dimensions) {
            this.logger.error('Embedding dimension mismatch', {
              expected: this.embeddingProvider.dimensions,
              received: vector.length,
            });
            return {
              ok: false,
              error: {
                type: 'embedding_error',
                message: 'Embedding provider returned invalid dimensions',
              },
            };
          }

          // Cache the embedding
          this.embeddingCache.set(cacheKey, vector);
        } catch (embedError) {
          this.logger.error('Embedding generation failed', {
            query: sanitizeForLogging(query, 50),
            error: sanitizeError(embedError),
          });
          return {
            ok: false,
            error: {
              type: 'embedding_error',
              message: 'Failed to generate embedding for query',
              cause: embedError,
            },
          };
        }
      }

      // Perform search with generated embedding
      return await this.searchInternal(vector, workspaceId, options);
    } catch (error) {
      this.logger.error('Unexpected error in search', {
        query: sanitizeForLogging(query, 50),
        workspaceId: sanitizeForLogging(workspaceId, 50),
        error: sanitizeError(error),
      });
      return {
        ok: false,
        error: {
          type: 'search_error',
          message: 'An unexpected error occurred during search',
          cause: error,
        },
      };
    }
  }

  /**
   * Search memories by pre-computed vector
   * 
   * Performs vector search using a provided embedding vector.
   * 
   * @param vector - Pre-computed embedding vector
   * @param workspaceId - Workspace ID for scoping
   * @param options - Search options for filtering
   * @returns Result with search results or error
   */
  async searchByVector(
    vector: number[],
    workspaceId: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], ContextError>> {
    // Validate inputs
    if (!vector || vector.length === 0) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'Vector is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'Workspace ID is required',
        },
      };
    }

    // Validate vector dimensions
    if (vector.length !== this.embeddingProvider.dimensions) {
      this.logger.warn('Vector dimension mismatch', {
        provided: vector.length,
        expected: this.embeddingProvider.dimensions,
      });
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: `Vector dimensions (${vector.length}) do not match expected dimensions (${this.embeddingProvider.dimensions})`,
        },
      };
    }

    // Validate vector contains valid numbers
    if (vector.some(v => !Number.isFinite(v))) {
      this.logger.warn('Vector contains invalid values', {
        workspaceId: sanitizeForLogging(workspaceId, 50),
      });
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'Vector contains invalid values (NaN or Infinity)',
        },
      };
    }

    // Perform search with provided vector
    return await this.searchInternal(vector, workspaceId, options);
  }

  /**
   * Internal method to build context from search results
   * 
   * Applies ranking, selects template, and formats results within token budget.
   * 
   * @param searchResults - Search results to format
   * @param options - Context options for formatting
   * @returns Result with formatted context or error
   */
  private buildContextInternal(
    searchResults: SearchResult[],
    options?: ContextOptions
  ): Result<ContextResult, ContextError> {
    try {
      // Apply ranking to search results
      let rankedResults = searchResults;

      if (options?.ranker) {
        // Use custom ranker if provided
        if (typeof options.ranker === 'function') {
          // Custom ranking function provided directly
          const rankingOptions: RankingOptions = {
            recencyWeight: 0.2,
            confidenceWeight: 0.2,
            similarityWeight: 0.4,
            decayWeight: 0.2,
          };
          rankedResults = options.ranker(searchResults, rankingOptions);
        } else if (typeof options.ranker === 'string') {
          // Named ranker from registry
          const rankerFn = this.rankers.get(options.ranker);
          if (!rankerFn) {
            return {
              ok: false,
              error: {
                type: 'validation_error',
                message: `Ranker "${options.ranker}" not found. Available rankers: ${Array.from(this.rankers.keys()).join(', ')}`,
              },
            };
          }
          const rankingOptions: RankingOptions = {
            recencyWeight: 0.2,
            confidenceWeight: 0.2,
            similarityWeight: 0.4,
            decayWeight: 0.2,
          };
          rankedResults = rankerFn(searchResults, rankingOptions);
        }
      } else {
        // Use default ranking
        const rankingOptions: RankingOptions = {
          recencyWeight: 0.2,
          confidenceWeight: 0.2,
          similarityWeight: 0.4,
          decayWeight: 0.2,
        };
        rankedResults = MemoryRanker.defaultRanking(searchResults, rankingOptions);
      }

      this.logger.debug('Applied ranking to search results', {
        originalCount: searchResults.length,
        rankedCount: rankedResults.length,
      });

      // Select template
      const templateName = options?.template ?? this.defaultTemplate;

      // Validate template name
      if (templateName && typeof templateName !== 'string') {
        return {
          ok: false,
          error: {
            type: 'validation_error',
            message: 'Template name must be a string',
          },
        };
      }

      const template = this.templates.get(templateName);

      if (!template) {
        this.logger.warn('Template not found', {
          requested: templateName,
          available: Array.from(this.templates.keys()),
        });
        return {
          ok: false,
          error: {
            type: 'template_not_found',
            template: templateName,
            message: `Template "${templateName}" not found. Available templates: ${Array.from(this.templates.keys()).join(', ')}`,
          },
        };
      }

      // Override template's includeMetadata if specified in options
      const effectiveTemplate: ContextTemplate = options?.includeMetadata !== undefined
        ? { ...template, includeMetadata: options.includeMetadata }
        : template;

      this.logger.debug('Selected template', {
        templateName,
        includeMetadata: effectiveTemplate.includeMetadata,
      });

      // Get token budget
      const tokenBudget = options?.tokenBudget ?? this.defaultTokenBudget;

      // Validate token budget
      if (tokenBudget <= 0) {
        this.logger.warn('Invalid token budget', { tokenBudget });
        return {
          ok: false,
          error: {
            type: 'validation_error',
            message: `Token budget must be positive, got ${tokenBudget}`,
          },
        };
      }

      // Format results using ContextFormatter
      const contextResult = this.formatter.format(
        rankedResults,
        effectiveTemplate,
        tokenBudget
      );

      this.logger.info('Context built successfully', {
        templateName,
        tokenCount: contextResult.tokenCount,
        tokenBudget,
        memoriesIncluded: contextResult.memories.length,
        truncated: contextResult.truncated,
      });

      return { ok: true, value: contextResult };
    } catch (error) {
      this.logger.error('Unexpected error building context', {
        error: sanitizeError(error),
      });
      return {
        ok: false,
        error: {
          type: 'search_error',
          message: 'An unexpected error occurred while building context',
          cause: error,
        },
      };
    }
  }

  /**
   * Build formatted context from text query
   * 
   * Searches for relevant memories and formats them into a context string
   * suitable for injection into AI prompts.
   * 
   * @param query - Text query to search for
   * @param workspaceId - Workspace ID for scoping
   * @param options - Context options for search and formatting
   * @returns Result with formatted context or error
   */
  async buildContext(
    query: string,
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextResult, ContextError>> {
    // Check context cache first
    const cacheKey = this.contextCache.generateKey({
      query,
      workspaceId,
      ...options,
    });

    const cachedContext = this.contextCache.get(cacheKey);
    if (cachedContext) {
      this.logger.debug('Context cache hit', {
        query: sanitizeForLogging(query, 50),
        workspaceId: sanitizeForLogging(workspaceId, 50),
      });

      return { ok: true, value: cachedContext };
    }

    // Perform search
    const searchResult = await this.search(query, workspaceId, options);

    if (!searchResult.ok) {
      this.logger.error('Search failed during buildContext', {
        query: sanitizeForLogging(query, 50),
        workspaceId: sanitizeForLogging(workspaceId, 50),
        errorType: searchResult.error.type,
      });
      return searchResult;
    }

    // Build context from search results
    const contextResult = await this.buildContextInternal(searchResult.value, options);

    // Cache successful context
    if (contextResult.ok) {
      this.contextCache.set(cacheKey, contextResult.value);
    }

    return contextResult;
  }

  /**
   * Build formatted context from pre-computed vector
   * 
   * Searches for relevant memories using a provided embedding vector and formats
   * them into a context string suitable for injection into AI prompts.
   * 
   * @param vector - Pre-computed embedding vector
   * @param workspaceId - Workspace ID for scoping
   * @param options - Context options for search and formatting
   * @returns Result with formatted context or error
   */
  async buildContextByVector(
    vector: number[],
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextResult, ContextError>> {
    // Perform search by vector
    const searchResult = await this.searchByVector(vector, workspaceId, options);

    if (!searchResult.ok) {
      this.logger.error('Search by vector failed during buildContextByVector', {
        workspaceId: sanitizeForLogging(workspaceId, 50),
        vectorDimensions: vector.length,
        errorType: searchResult.error.type,
      });
      return searchResult;
    }

    // Build context from search results
    return this.buildContextInternal(searchResult.value, options);
  }

  /**
   * Preview context before injection
   * 
   * Uses the same pipeline as buildContext() but returns additional diagnostic
   * metadata including memory IDs, ranking scores, and budget usage.
   * 
   * @param query - Text query to search for
   * @param workspaceId - Workspace ID for scoping
   * @param options - Context options for search and formatting
   * @returns Result with context preview including diagnostic metadata or error
   */
  async previewContext(
    query: string,
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextPreview, ContextError>> {
    // Perform search
    const searchResult = await this.search(query, workspaceId, options);

    if (!searchResult.ok) {
      this.logger.error('Search failed during previewContext', {
        query: sanitizeForLogging(query, 50),
        workspaceId: sanitizeForLogging(workspaceId, 50),
        errorType: searchResult.error.type,
      });
      return searchResult;
    }

    // Build context from search results (same pipeline as buildContext)
    const contextResult = this.buildContextInternal(searchResult.value, options);

    if (!contextResult.ok) {
      return contextResult;
    }

    // Extract the base context result
    const baseResult = contextResult.value;

    // Build additional diagnostic metadata
    const memoryIds = baseResult.memories.map((result) => result.memory.id);

    // Build ranking scores map (memory ID -> rank score)
    const rankingScores: Record<string, number> = {};
    for (const result of baseResult.memories) {
      // Use rank if available, otherwise use similarity score
      rankingScores[result.memory.id] = result.rank ?? result.score;
    }

    // Calculate budget usage percentage
    const tokenBudget = options?.tokenBudget ?? this.defaultTokenBudget;
    const budgetUsed = Math.round((baseResult.tokenCount / tokenBudget) * 100);

    // Create preview result with additional metadata
    const preview: ContextPreview = {
      ...baseResult,
      memoryIds,
      rankingScores,
      budgetUsed,
    };

    this.logger.info('Context preview generated successfully', {
      query: sanitizeForLogging(query, 50),
      workspaceId: sanitizeForLogging(workspaceId, 50),
      memoryCount: memoryIds.length,
      tokenCount: baseResult.tokenCount,
      budgetUsed: `${budgetUsed}%`,
      truncated: baseResult.truncated,
    });

    return { ok: true, value: preview };
  }

  /**
   * Get cache statistics
   * 
   * Returns statistics for all caches including hit rates, sizes, and evictions.
   * 
   * @returns Cache statistics object
   */
  getCacheStats() {
    return {
      embedding: {
        ...this.embeddingCache.getStats(),
        hitRate: this.embeddingCache.getHitRate(),
      },
      result: {
        ...this.resultCache.getStats(),
        hitRate: this.resultCache.getHitRate(),
      },
      context: {
        ...this.contextCache.getStats(),
        hitRate: this.contextCache.getHitRate(),
      },
    };
  }

  /**
   * Clear all caches
   * 
   * Clears the embedding, result, and context caches and resets statistics.
   */
  clearCaches(): void {
    this.embeddingCache.clear();
    this.resultCache.clear();
    this.contextCache.clear();

    this.logger.info('All caches cleared');
  }
}

// Re-export types and utilities
export * from './types';
export * from './errors';
export { OpenAIEmbeddingProvider } from './embeddings/openai';
export { EmbeddingCache } from './embeddings/cache';
export { MemoryRanker } from './ranker';
export { DEFAULT_TEMPLATES, substituteTemplateVariables } from './templates';
export { TiktokenTokenizer, CharacterTokenizer } from './tokenizer';
export { ContextFormatter } from './formatter';
