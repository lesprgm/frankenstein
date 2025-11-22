# Requirements Document: Conversation Chunking for Large Context Windows

## Introduction

The memory extraction system currently sends entire conversations to LLMs in a single API call. This fails when conversations exceed the model's context window (e.g., 12M tokens vs 800k token limit). This feature adds intelligent chunking to handle arbitrarily large conversations while maintaining extraction quality.

## Glossary

- **Token**: The basic unit of text that LLMs process (roughly 0.75 words)
- **Context Window**: Maximum number of tokens an LLM can process in one request
- **Chunk**: A subset of a conversation that fits within the context window
- **Overlap**: Tokens shared between adjacent chunks to maintain context continuity
- **Token Counter**: Component that estimates token count for text
- **Chunking Strategy**: Algorithm for dividing conversations into chunks
- **Memory Extractor**: The system component that extracts structured memories from conversations

## Requirements

### Requirement 1: Token Counting

**User Story:** As a developer, I want the system to accurately count tokens in conversations, so that I can determine if chunking is needed.

#### Acceptance Criteria

1. THE Memory Extractor SHALL provide a token counting utility that estimates token count for conversation text
2. THE token counter SHALL support multiple tokenization methods (OpenAI, Anthropic, Gemini, approximate)
3. THE token counter SHALL return token counts with reasonable accuracy (within 5% of actual)
4. THE token counter SHALL handle multi-language text including Unicode characters
5. WHERE a specific model tokenizer is unavailable, THE system SHALL use an approximation method

### Requirement 2: Automatic Chunking Detection

**User Story:** As a developer, I want the system to automatically detect when a conversation needs chunking, so that I don't have to manually check sizes.

#### Acceptance Criteria

1. WHEN a conversation is submitted for extraction, THE Memory Extractor SHALL calculate the total token count
2. IF the token count exceeds the configured threshold, THEN THE Memory Extractor SHALL automatically chunk the conversation
3. THE system SHALL use a configurable token limit per chunk (default: 80% of model's context window)
4. THE system SHALL log when chunking is triggered with conversation ID and token counts
5. THE system SHALL allow users to disable automatic chunking via configuration

### Requirement 3: Sliding Window Chunking Strategy

**User Story:** As a developer, I want a sliding window chunking strategy, so that conversations are split into overlapping segments that maintain context.

#### Acceptance Criteria

1. THE system SHALL implement a sliding window chunking strategy
2. THE sliding window strategy SHALL create chunks of configurable maximum size
3. THE sliding window strategy SHALL include configurable overlap between adjacent chunks (default: 10% of chunk size)
4. THE sliding window strategy SHALL preserve message boundaries (never split a message mid-content)
5. THE sliding window strategy SHALL maintain chronological order of messages

### Requirement 4: Conversation Boundary Chunking Strategy

**User Story:** As a developer, I want a conversation boundary chunking strategy, so that conversations are split at natural topic transitions.

#### Acceptance Criteria

1. THE system SHALL implement a conversation boundary chunking strategy
2. THE conversation boundary strategy SHALL identify natural break points in conversations
3. THE conversation boundary strategy SHALL prefer splitting at user message boundaries
4. THE conversation boundary strategy SHALL avoid creating chunks smaller than a minimum threshold (default: 20% of max chunk size)
5. THE conversation boundary strategy SHALL fall back to sliding window if no suitable boundaries exist

### Requirement 5: Semantic Chunking Strategy

**User Story:** As a developer, I want a semantic chunking strategy, so that conversations are split based on topic coherence.

#### Acceptance Criteria

1. THE system SHALL implement a semantic chunking strategy
2. THE semantic strategy SHALL analyze message content to identify topic shifts
3. THE semantic strategy SHALL use embedding similarity or keyword analysis to detect topic changes
4. THE semantic strategy SHALL create chunks that maintain topical coherence
5. THE semantic strategy SHALL respect maximum chunk size limits even when topics are long

### Requirement 6: Chunk Metadata Preservation

**User Story:** As a developer, I want chunk metadata to be preserved, so that extracted memories can be traced back to their source chunks.

#### Acceptance Criteria

1. WHEN a conversation is chunked, THE system SHALL assign each chunk a unique identifier
2. THE system SHALL preserve the original conversation ID in each chunk
3. THE system SHALL record chunk sequence numbers (e.g., chunk 1 of 5)
4. THE system SHALL record token counts for each chunk
5. THE system SHALL record which messages are included in each chunk

### Requirement 7: Memory Extraction from Chunks

**User Story:** As a developer, I want memories to be extracted from each chunk independently, so that large conversations can be processed completely.

#### Acceptance Criteria

1. THE Memory Extractor SHALL process each chunk as a separate extraction request
2. THE Memory Extractor SHALL include chunk context (previous chunk summary) in extraction prompts
3. THE Memory Extractor SHALL tag extracted memories with their source chunk ID
4. THE Memory Extractor SHALL handle extraction failures for individual chunks without failing the entire conversation
5. THE Memory Extractor SHALL process chunks sequentially to maintain context flow

### Requirement 8: Memory Deduplication Across Chunks

**User Story:** As a developer, I want duplicate memories across chunks to be merged, so that the same entity mentioned in multiple chunks appears only once.

#### Acceptance Criteria

1. AFTER extracting memories from all chunks, THE system SHALL deduplicate memories across chunks
2. THE deduplication SHALL use content similarity and entity matching to identify duplicates
3. WHEN duplicates are found, THE system SHALL merge them keeping the highest confidence score
4. THE system SHALL preserve all source chunk references in merged memories
5. THE system SHALL log the number of duplicates found and merged

### Requirement 9: Relationship Preservation Across Chunks

**User Story:** As a developer, I want relationships between memories in different chunks to be preserved, so that the knowledge graph remains connected.

#### Acceptance Criteria

1. THE system SHALL identify relationships between memories extracted from different chunks
2. THE system SHALL use memory IDs to link relationships across chunk boundaries
3. THE system SHALL validate that relationship endpoints exist after deduplication
4. THE system SHALL remove orphaned relationships where one endpoint was deduplicated
5. THE system SHALL maintain relationship confidence scores during cross-chunk merging

### Requirement 10: Configurable Chunking Parameters

**User Story:** As a developer, I want to configure chunking parameters, so that I can optimize for different use cases and models.

#### Acceptance Criteria

1. THE system SHALL accept configuration for maximum tokens per chunk
2. THE system SHALL accept configuration for overlap size (tokens or percentage)
3. THE system SHALL accept configuration for chunking strategy selection
4. THE system SHALL accept configuration for minimum chunk size
5. THE system SHALL validate configuration parameters and provide clear error messages for invalid values

### Requirement 11: Chunking Performance Monitoring

**User Story:** As a developer, I want to monitor chunking performance, so that I can optimize extraction for large conversations.

#### Acceptance Criteria

1. THE system SHALL log total processing time for chunked conversations
2. THE system SHALL log time spent on chunking vs extraction vs deduplication
3. THE system SHALL log the number of chunks created per conversation
4. THE system SHALL log token counts (total, per chunk, overlap)
5. THE system SHALL provide metrics on memory extraction rate (memories per chunk)

### Requirement 12: Error Handling for Chunked Extraction

**User Story:** As a developer, I want robust error handling for chunked extraction, so that partial failures don't lose all extracted data.

#### Acceptance Criteria

1. IF a chunk extraction fails, THE system SHALL continue processing remaining chunks
2. THE system SHALL collect all extraction errors and include them in the final result
3. THE system SHALL return successfully extracted memories even if some chunks failed
4. THE system SHALL log which chunks failed with error details
5. THE system SHALL allow configuration for failure tolerance (fail-fast vs continue-on-error)

### Requirement 13: Backward Compatibility

**User Story:** As a developer, I want chunking to be backward compatible, so that existing code continues to work without changes.

#### Acceptance Criteria

1. THE system SHALL work with existing extraction code without requiring changes
2. WHEN chunking is disabled, THE system SHALL behave identically to the current implementation
3. THE system SHALL use sensible defaults that work for most use cases
4. THE system SHALL maintain the existing API surface for MemoryExtractor
5. THE system SHALL provide opt-in configuration for advanced chunking features

### Requirement 14: Token Counter Accuracy Testing

**User Story:** As a developer, I want to verify token counter accuracy, so that I can trust chunking decisions.

#### Acceptance Criteria

1. THE system SHALL provide a utility to compare estimated vs actual token counts
2. THE system SHALL include test cases with known token counts for various models
3. THE system SHALL measure and report token counting accuracy metrics
4. THE system SHALL document expected accuracy ranges for each counting method
5. THE system SHALL warn users when using approximate counting methods

### Requirement 15: Chunking Strategy Selection

**User Story:** As a developer, I want to choose the best chunking strategy for my use case, so that extraction quality is optimized.

#### Acceptance Criteria

1. THE system SHALL provide clear documentation on when to use each chunking strategy
2. THE system SHALL allow runtime strategy selection via configuration
3. THE system SHALL support custom chunking strategies via a plugin interface
4. THE system SHALL validate that selected strategies are compatible with the provider
5. THE system SHALL fall back to sliding window if the selected strategy fails
