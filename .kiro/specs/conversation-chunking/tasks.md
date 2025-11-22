# Implementation Plan: Conversation Chunking

## Overview

This implementation plan breaks down the conversation chunking feature into incremental, testable tasks. Each task builds on previous work and can be validated independently.

## Task List

- [x] 1. Set up token counting infrastructure
  - [x] 1.1 Install and configure tiktoken library for OpenAI token counting
    - Add `tiktoken` to package.json dependencies
    - Create wrapper for tiktoken with error handling
    - _Requirements: 1.1, 1.5_
  
  - [x] 1.2 Implement TokenCounter class with multiple counting methods
    - Create `src/chunking/token-counter.ts`
    - Implement `count()` method with method selection
    - Implement `countConversation()` for full conversations
    - Implement `getRecommendedMethod()` for provider-specific recommendations
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 1.3 Implement approximate token counting for non-OpenAI providers
    - Add character-based estimation (length / 4)
    - Add word-based estimation with adjustments
    - Document accuracy expectations
    - _Requirements: 1.3, 1.5_
  
  - [x] 1.4 Add token count caching to avoid recomputation
    - Implement LRU cache for message token counts
    - Add cache hit/miss metrics
    - _Requirements: 1.1_
  
  - [x] 1.5 Write unit tests for token counter
    - Test with known token counts for various models
    - Test accuracy of approximation methods
    - Test caching behavior
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 2. Implement base chunking infrastructure
  - [x] 2.1 Define chunking interfaces and types
    - Create `src/chunking/types.ts` with ChunkingStrategy, ChunkingConfig, ConversationChunk
    - Define ChunkingConfig with all parameters
    - Define ConversationChunk with metadata
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [x] 2.2 Create ChunkingOrchestrator class
    - Create `src/chunking/orchestrator.ts`
    - Implement `needsChunking()` decision logic
    - Implement strategy selection logic
    - Add logging for chunking decisions
    - _Requirements: 2.1, 2.2, 2.4_
  
  - [x] 2.3 Implement base ChunkingStrategy abstract class
    - Create `src/chunking/strategies/base.ts`
    - Define abstract `chunk()` method
    - Define abstract `canHandle()` method
    - Add utility methods for message token counting
    - _Requirements: 15.1, 15.3_

- [x] 3. Implement sliding window chunking strategy
  - [x] 3.1 Create SlidingWindowStrategy class
    - Create `src/chunking/strategies/sliding-window.ts`
    - Implement basic sliding window algorithm
    - Ensure message boundaries are preserved
    - _Requirements: 3.1, 3.4, 3.5_
  
  - [x] 3.2 Implement overlap calculation
    - Calculate overlap in tokens
    - Calculate overlap in messages
    - Ensure overlap doesn't exceed chunk size
    - _Requirements: 3.2, 3.3_
  
  - [x] 3.3 Add chunk metadata generation
    - Generate unique chunk IDs
    - Record sequence numbers
    - Record token counts and overlap info
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [x] 3.4 Write unit tests for sliding window strategy
    - Test with various conversation sizes
    - Test overlap behavior
    - Test edge cases (single message, empty conversation)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Implement conversation boundary chunking strategy
  - [x] 4.1 Create ConversationBoundaryStrategy class
    - Create `src/chunking/strategies/conversation-boundary.ts`
    - Implement boundary detection logic
    - Identify user message boundaries
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [x] 4.2 Implement boundary scoring algorithm
    - Score boundaries based on context continuity
    - Prefer user messages as split points
    - Consider timestamp gaps
    - _Requirements: 4.2, 4.3_
  
  - [x] 4.3 Add fallback to sliding window
    - Detect when no suitable boundaries exist
    - Fall back to sliding window strategy
    - Log fallback decisions
    - _Requirements: 4.4, 4.5, 15.5_
  
  - [x] 4.4 Write unit tests for conversation boundary strategy
    - Test boundary detection
    - Test fallback behavior
    - Test minimum chunk size enforcement
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Implement semantic chunking strategy
  - [x] 5.1 Create SemanticStrategy class
    - Create `src/chunking/strategies/semantic.ts`
    - Implement keyword extraction for messages
    - Calculate keyword overlap between messages
    - _Requirements: 5.1, 5.2_
  
  - [x] 5.2 Implement topic shift detection
    - Identify low-similarity boundaries
    - Score topic coherence within chunks
    - Balance topic coherence with size limits
    - _Requirements: 5.2, 5.3, 5.4_
  
  - [x] 5.3 Add size limit enforcement
    - Ensure chunks don't exceed max size
    - Split long topics if necessary
    - _Requirements: 5.4, 5.5_
  
  - [x] 5.4 Write unit tests for semantic strategy
    - Test topic shift detection
    - Test size limit enforcement
    - Test with various conversation types
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. Implement chunk-based extraction
  - [x] 6.1 Modify extraction strategies to support chunks
    - Update StructuredOutputStrategy to accept chunk context
    - Add previous chunk summary to prompts
    - Tag extracted memories with chunk IDs
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 6.2 Implement sequential chunk processing
    - Process chunks in order
    - Pass context from previous chunks
    - Collect results from all chunks
    - _Requirements: 7.5_
  
  - [x] 6.3 Add error handling for chunk failures
    - Continue processing on chunk failure
    - Collect all errors
    - Support fail-fast mode
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [x] 6.4 Implement chunk result aggregation
    - Combine memories from all chunks
    - Combine relationships from all chunks
    - Generate chunking metadata
    - _Requirements: 7.1, 11.1, 11.2, 11.3, 11.4_

- [x] 7. Implement cross-chunk deduplication
  - [x] 7.1 Create ChunkDeduplicator class
    - Create `src/chunking/deduplicator.ts`
    - Implement memory similarity calculation
    - Group memories by type for comparison
    - _Requirements: 8.1, 8.2_
  
  - [x] 7.2 Implement memory merging logic
    - Merge duplicate memories
    - Keep highest confidence score
    - Preserve all source chunk references
    - _Requirements: 8.3, 8.4, 8.5_
  
  - [x] 7.3 Implement relationship merging
    - Update relationship references after deduplication
    - Remove orphaned relationships
    - Validate relationship endpoints
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [x] 7.4 Write unit tests for deduplication
    - Test duplicate detection
    - Test memory merging
    - Test relationship updates
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 8. Integrate chunking into MemoryExtractor
  - [x] 8.1 Add chunking configuration to MemoryExtractorConfig
    - Extend config interface with chunking options
    - Set sensible defaults
    - Validate configuration parameters
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  
  - [x] 8.2 Initialize ChunkingOrchestrator in MemoryExtractor
    - Create orchestrator if chunking enabled
    - Load chunking strategies
    - Initialize token counter
    - _Requirements: 2.1, 2.2_
  
  - [x] 8.3 Modify extract() method to support chunking
    - Check if chunking is needed
    - Route to chunked extraction if needed
    - Maintain backward compatibility
    - _Requirements: 2.1, 2.2, 2.5, 13.1, 13.2, 13.3, 13.4_
  
  - [x] 8.4 Add extractWithChunking() method
    - Delegate to ChunkingOrchestrator
    - Handle chunked extraction results
    - Return standard ExtractionResult format
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 9. Add monitoring and logging
  - [x] 9.1 Add chunking metrics collection
    - Track total processing time
    - Track time per phase (chunking, extraction, deduplication)
    - Track chunk counts and sizes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [x] 9.2 Add detailed logging for chunking operations
    - Log when chunking is triggered
    - Log chunk creation details
    - Log deduplication results
    - Log performance metrics
    - _Requirements: 2.4, 8.5, 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [x] 9.3 Add chunking metadata to extraction results
    - Include chunking strategy used
    - Include chunk count and sizes
    - Include processing time breakdown
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 10. Write integration tests
  - [x] 10.1 Test end-to-end chunking with large conversations
    - Create test conversations of various sizes
    - Test with each chunking strategy
    - Verify memories are extracted correctly
    - _Requirements: 2.1, 2.2, 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 10.2 Test cross-chunk deduplication
    - Create conversations with repeated entities
    - Verify duplicates are merged
    - Verify relationships are preserved
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [x] 10.3 Test error handling with chunk failures
    - Simulate chunk extraction failures
    - Verify partial results are returned
    - Test fail-fast vs continue-on-error modes
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [x] 10.4 Test backward compatibility
    - Verify existing code works without changes
    - Test with chunking disabled
    - Verify API compatibility
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 11. Add documentation and examples
  - [x] 11.1 Document chunking configuration options
    - Document all config parameters
    - Provide usage examples
    - Document when to use each strategy
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 15.1_
  
  - [x] 11.2 Create example scripts for chunking
    - Example with large conversation
    - Example with different strategies
    - Example with custom configuration
    - _Requirements: 15.1, 15.2_
  
  - [x] 11.3 Document token counting accuracy
    - Document expected accuracy for each method
    - Provide guidance on method selection
    - Document limitations
    - _Requirements: 14.4, 14.5_
  
  - [x] 11.4 Add migration guide
    - Guide for enabling chunking
    - Performance implications
    - Breaking changes (if any)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 12. Performance optimization
  - [x] 12.1 Optimize token counting performance
    - Profile token counting overhead
    - Optimize caching strategy
    - Consider lazy counting
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 12.2 Optimize chunk processing
    - Profile extraction overhead per chunk
    - Consider parallel processing for independent chunks
    - Optimize memory usage
    - _Requirements: 7.1, 7.5_
  
  - [x] 12.3 Add performance benchmarks
    - Benchmark with various conversation sizes
    - Compare strategies
    - Measure overhead vs non-chunked extraction
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

## Notes

- Tasks marked with `*` are optional testing tasks that can be skipped for MVP
- Each task should be completed and tested before moving to the next
- Integration tests (task 10) should be run after all core functionality is complete
- Documentation (task 11) can be done in parallel with implementation
- Performance optimization (task 12) should be done after core functionality is stable
