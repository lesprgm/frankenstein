# Implementation Plan

- [x] 1. Set up project structure and core types
  - Create `packages/core/memory-extraction/` directory with package.json and tsconfig.json
  - Define ExtractedMemory and ExtractedRelationship interfaces in `src/types.ts`
  - Define ExtractionResult and BatchExtractionResult interfaces in `src/types.ts`
  - Define ExtractionError type and Result type in `src/errors.ts`
  - Define MemoryExtractorConfig and ExtractionOptions interfaces in `src/types.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 2.6, 3.1, 3.2, 3.3, 3.5, 3.6, 9.2_

- [x] 2. Implement LLMProvider interface and OpenAIProvider
  - Create `src/providers/base.ts` with LLMProvider interface
  - Create `src/providers/openai.ts` with OpenAIProvider class
  - Implement complete() method for basic completions
  - Implement completeStructured() method using OpenAI's response_format
  - Add error handling for API failures and rate limits
  - Add retry logic with exponential backoff
  - _Requirements: 5.1, 5.2, 5.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 3. Implement ExtractionStrategy interface and StructuredOutputStrategy
  - Create `src/strategies/base.ts` with ExtractionStrategy interface
  - Create `src/strategies/structured.ts` with StructuredOutputStrategy class
  - Implement extract() method that builds prompt and calls LLM with structured output
  - Define JSON schema for memory extraction (entities, facts, decisions)
  - Implement extractIncremental() method for streaming support
  - Parse LLM response and create ExtractedMemory objects with all required fields
  - Extract relationships between memories from LLM response
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 2.6, 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1_

- [x] 4. Implement MemoryDeduplicator
  - Create `src/deduplicator.ts` with MemoryDeduplicator class
  - Implement generateMemoryId() that creates deterministic IDs from hash(type + normalized_content + workspace_id)
  - Implement content normalization (lowercase, trim, remove extra whitespace)
  - Implement areDuplicates() to check if two memories are duplicates
  - Implement deduplicate() to remove duplicate memories from array
  - Implement merge() to combine duplicate memories (keep highest confidence, merge source_message_ids and metadata)
  - _Requirements: 1.4, 6.2, 6.3, 7.2, 7.4_

- [x] 5. Implement MemoryValidator
  - Create `src/validator.ts` with MemoryValidator class
  - Implement validate() for single memory validation
  - Check required fields: type, content, confidence, workspace_id, conversation_id
  - Validate confidence is between 0 and 1
  - Validate content is not empty or trivial (< 3 chars)
  - Implement validateBatch() for multiple memories
  - Implement validateRelationships() to ensure relationships reference existing memories
  - Validate relationships connect memories in same workspace
  - Filter out memories below configured confidence threshold
  - _Requirements: 4.6, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6. Implement default memory type configurations
  - Create `src/memory-types.ts` with default memory type configs
  - Define entity type config with extraction prompt and schema
  - Define fact type config with extraction prompt and schema
  - Define decision type config with extraction prompt and schema
  - Include metadata schemas for each type (entity: name, entityType, description; fact: statement, category; decision: decision, rationale, alternatives)
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 10.5_

- [x] 7. Implement MemoryExtractor main class - single extraction
  - Create `src/index.ts` with MemoryExtractor class
  - Implement constructor that initializes provider, strategy, and config
  - Implement extract() method for single conversation
  - Accept workspace_id as required parameter and tag all memories with it
  - Call strategy.extract() to get raw extraction result
  - Use MemoryDeduplicator to generate stable IDs for all memories
  - Use MemoryValidator to validate memories and relationships
  - Filter memories below minConfidence threshold
  - Include source conversation_id and message IDs in all memories
  - Return ExtractionResult with memories, relationships, and status
  - _Requirements: 1.5, 1.6, 2.5, 2.6, 3.5, 3.6, 4.4, 5.4, 5.5, 8.3_

- [x] 8. Implement MemoryExtractor - batch extraction
  - Implement extractBatch() method for multiple conversations
  - Process conversations with configured batch size
  - Handle extraction failures for individual conversations without failing entire batch
  - Collect all memories from successful extractions
  - Use MemoryDeduplicator to deduplicate across all conversations in batch
  - Validate all memories and relationships
  - Return BatchExtractionResult with per-conversation status
  - Include totalMemories, totalRelationships, successCount, failureCount
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 9. Implement IncrementalExtractor
  - Create `src/incremental.ts` with IncrementalExtractor class
  - Implement constructor that accepts conversationId, workspaceId, strategy, and config
  - Implement addMessages() to accumulate messages and trigger extraction
  - Use MemoryDeduplicator.generateMemoryId() for all new and updated memories
  - Track existing memories and merge with new extractions
  - Implement finalize() to create final ExtractionResult
  - Implement getState() to return current extraction state
  - Implement event emitter for 'memory' and 'relationship' events
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 10. Implement createIncrementalExtractor in MemoryExtractor
  - Add createIncrementalExtractor() method to MemoryExtractor class
  - Create and return IncrementalExtractor instance with current config
  - Pass strategy and provider to incremental extractor
  - _Requirements: 7.1, 7.5_

- [x] 11. Implement custom memory type registration
  - Add registerMemoryType() method to MemoryExtractor class
  - Store custom memory type configs in registry
  - Include custom types in extraction when configured
  - Validate custom memory types against provided schema
  - Allow custom extraction prompts for each type
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 12. Implement extraction profiles
  - Create `src/profiles.ts` with profile management
  - Define ExtractionProfile interface with strategy, provider, modelParams, memoryTypes, minConfidence
  - Add registerProfile() method to MemoryExtractor class
  - Store profiles in registry
  - Allow ExtractionOptions to specify profile name
  - Apply profile settings when profile is specified
  - _Requirements: 5.6_

- [x] 13. Implement error handling and logging
  - Ensure all methods return Result<T, ExtractionError> types
  - Add logging for LLM API failures with conversation context
  - Add logging for validation failures with memory identifiers
  - Handle rate limit errors with retry queue
  - Return partial results when some extractions succeed
  - Add context to all error messages (provider, conversation, etc.)
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 14. Write unit tests for strategies
  - Test StructuredOutputStrategy with mock LLM responses
  - Test prompt building for different memory types
  - Test response parsing with valid and invalid LLM outputs
  - Test extractIncremental() with message chunks
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 5.1_

- [x] 15. Write unit tests for deduplicator
  - Test generateMemoryId() produces stable IDs
  - Test content normalization
  - Test areDuplicates() with various memory pairs
  - Test deduplicate() removes duplicates correctly
  - Test merge() combines duplicate memories properly
  - _Requirements: 1.4, 6.2, 6.3, 7.2, 7.4_

- [x] 16. Write unit tests for validator
  - Test validation with valid memories
  - Test validation with missing required fields
  - Test validation with invalid confidence scores
  - Test validation with empty or trivial content
  - Test relationship validation with existing and non-existing memories
  - Test workspace validation for relationships
  - _Requirements: 4.6, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 17. Write integration tests for MemoryExtractor
  - Test single extraction with real OpenAI API
  - Test batch extraction with multiple conversations
  - Test deduplication across conversations
  - Test incremental extraction with streaming messages
  - Test custom memory type registration and extraction
  - Test profile-based configuration
  - Test error handling with API failures
  - Test partial results with mixed success/failure
  - _Requirements: 6.1, 6.4, 7.1, 7.6, 9.3, 10.1, 10.4, 5.6_
