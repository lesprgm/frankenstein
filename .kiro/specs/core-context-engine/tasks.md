# Implementation Plan

- [x] 1. Set up project structure and core types
  - Create `packages/core/context-engine/` directory with package.json and tsconfig.json
  - Define SearchResult, ContextResult, and ContextPreview interfaces in `src/types.ts`
  - Define ContextError type and Result type in `src/errors.ts`
  - Define ContextEngineConfig, SearchOptions, and ContextOptions interfaces in `src/types.ts`
  - _Requirements: 1.7, 9.3_

- [x] 2. Implement EmbeddingProvider interface and OpenAIEmbeddingProvider
  - Create `src/embeddings/base.ts` with EmbeddingProvider interface
  - Create `src/embeddings/openai.ts` with OpenAIEmbeddingProvider class
  - Implement embed() method using OpenAI embeddings API
  - Implement embedBatch() method for batch embedding generation
  - Expose dimensions and model properties
  - Add error handling for API failures
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 9.1_

- [x] 3. Implement EmbeddingCache
  - Create `src/embeddings/cache.ts` with EmbeddingCache class
  - Implement get() and set() methods with in-memory storage
  - Implement generateKey() that creates cache key from query text and model
  - Implement clear() method
  - Add TTL support for cache entries
  - Add max size limit with LRU eviction
  - _Requirements: 5.3_

- [x] 4. Implement Tokenizer interface and implementations
  - Create `src/tokenizer.ts` with Tokenizer interface
  - Implement TiktokenTokenizer using tiktoken library
  - Implement CharacterTokenizer as fallback (1 token ≈ 4 characters)
  - Implement count(), encode(), and decode() methods
  - _Requirements: 3.2, 3.3_

- [x] 5. Implement MemoryRanker
  - Create `src/ranker.ts` with MemoryRanker class
  - Implement defaultRanking() that combines similarity, recency, and confidence
  - Calculate recency_score as 1 / (1 + days_since_creation)
  - Implement bySimilarity(), byRecency(), and byConfidence() ranking functions
  - Implement custom() ranking function that accepts custom score function
  - Assign rank property to SearchResult objects
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6. Implement ContextTemplate and default templates
  - Create `src/templates.ts` with ContextTemplate interface
  - Define DEFAULT_TEMPLATES with 'chat', 'detailed', and 'summary' templates
  - Implement template variable substitution ({{content}}, {{type}}, {{confidence}}, {{timestamp}}, {{score}})
  - Support conditional formatting based on includeMetadata flag
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Implement ContextFormatter
  - Create `src/formatter.ts` with ContextFormatter class
  - Implement format() method that applies template to memories
  - Implement estimateTokens() using configured tokenizer
  - Implement truncateToFit() that keeps highest-ranked memories within budget
  - Track token count and truncation status
  - Apply template header, memory format, separator, and footer
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 8. Implement ContextEngine - initialization and configuration
  - Create `src/index.ts` with ContextEngine class
  - Implement constructor that accepts ContextEngineConfig
  - Initialize embedding cache with configured settings
  - Validate embeddingProvider.dimensions matches expectedEmbeddingDimensions if provided
  - Initialize default templates and rankers
  - Store storageClient reference for all data access
  - _Requirements: 1.3, 5.5_

- [x] 9. Implement ContextEngine - search methods
  - Implement private searchInternal() method that performs vector search via Storage Layer
  - Implement search() that generates embedding and calls searchInternal()
  - Implement searchByVector() that validates vector dimensions and calls searchInternal()
  - Require workspace_id parameter for all search operations
  - Apply filters (memoryTypes, dateFrom, dateTo, minConfidence, conversationId) to search
  - Call storageClient.searchMemories() with workspace scoping
  - Return SearchResult array with similarity scores
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 10. Implement relationship expansion
  - Add relationship expansion logic to searchInternal()
  - When includeRelationships is true, fetch relationships via storageClient.getMemoryRelationships()
  - Follow relationships up to configured relationshipDepth
  - Fetch related memories via storageClient.getMemory()
  - Deduplicate memories across relationship traversal
  - Track relationship depth for each related memory
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 11. Implement ContextEngine - buildContext methods
  - Implement private buildContextInternal() that formats search results
  - Implement buildContext() that searches and formats in one call
  - Implement buildContextByVector() that searches by vector and formats
  - Apply ranking to search results before formatting
  - Select template (default or specified in options)
  - Call ContextFormatter.format() with token budget
  - Return ContextResult with formatted context, token count, memories, and truncation status
  - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7_

- [x] 12. Implement ContextEngine - preview method
  - Implement previewContext() method
  - Use same pipeline as buildContext() (search → rank → format)
  - Include additional diagnostic metadata in ContextPreview
  - Return memory IDs of included memories
  - Return ranking scores for each memory
  - Calculate and return budget usage percentage
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 13. Implement custom template and ranker registration
  - Implement registerTemplate() method to add custom templates
  - Store templates in internal registry
  - Implement registerRanker() method to add custom ranking functions
  - Store rankers in internal registry
  - Validate template and ranker names don't conflict with defaults
  - _Requirements: 2.4, 7.2_

- [x] 14. Implement error handling and logging
  - Ensure all methods return Result<T, ContextError> types
  - Handle embedding generation failures gracefully
  - Handle vector search failures via Storage Layer error propagation
  - Return empty context on search failures (caller decides to degrade)
  - Log errors with query context but sanitize internal details
  - Add validation for vector dimensions, workspace_id, and template names
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 15. Write unit tests for embedding cache
  - Test cache hit and miss scenarios
  - Test cache key generation with different queries and models
  - Test TTL expiration
  - Test max size limit and LRU eviction
  - _Requirements: 5.3_

- [x] 16. Write unit tests for ranker
  - Test defaultRanking with various weight combinations
  - Test bySimilarity, byRecency, byConfidence ranking functions
  - Test custom ranking function
  - Test recency score calculation
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 17. Write unit tests for formatter
  - Test format() with different templates
  - Test token estimation accuracy
  - Test truncateToFit() respects budget
  - Test template variable substitution
  - Test metadata inclusion/exclusion
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 18. Write integration tests for ContextEngine
  - Test end-to-end search with real Storage Layer and embeddings
  - Test buildContext with various options
  - Test relationship expansion with real relationships
  - Test token budget enforcement with real memories
  - Test preview matches final output
  - Test custom templates and rankers
  - Test error handling with API failures
  - Test graceful degradation on search failures
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 4.1, 7.2, 9.1, 9.4, 10.2_
