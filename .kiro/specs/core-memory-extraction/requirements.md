# Requirements Document

## Introduction

The Memory Extraction module analyzes conversations and extracts structured memories (entities, facts, decisions) using LLM-based analysis. It provides a configurable extraction pipeline that can be tuned for different use cases (personal vs team memory, different memory types). The module outputs Memory objects with confidence scores and relationships between memories.

## Glossary

- **Memory Extraction**: The module that analyzes conversations and extracts structured memories
- **Entity**: A person, place, organization, or concept mentioned in conversations
- **Fact**: A piece of information or knowledge stated in conversations
- **Decision**: A choice or conclusion made during conversations
- **Confidence Score**: A value between 0 and 1 indicating extraction certainty
- **Relationship**: A typed connection between two memories (e.g., "person works_at organization")
- **Extraction Strategy**: A configurable approach for memory extraction (prompt-based, structured output)

## Requirements

### Requirement 1

**User Story:** As a developer building on MemoryLayer, I want to extract entities from conversations, so that I can track people, organizations, and concepts mentioned by users.

#### Acceptance Criteria

1. THE Memory Extraction SHALL identify entities (people, organizations, places, concepts) in conversation messages
2. THE Memory Extraction SHALL extract entity attributes (name, type, description)
3. THE Memory Extraction SHALL assign confidence scores to extracted entities
4. THE Memory Extraction SHALL deduplicate entities across multiple messages
5. THE Memory Extraction SHALL include source conversation ID and source message IDs for each extracted entity
6. THE Memory Extraction SHALL accept workspace_id as input and tag extracted entities with workspace context

### Requirement 2

**User Story:** As a developer, I want to extract facts from conversations, so that I can capture knowledge and information shared during chats.

#### Acceptance Criteria

1. THE Memory Extraction SHALL identify factual statements in conversation messages
2. THE Memory Extraction SHALL extract fact content and categorization
3. THE Memory Extraction SHALL assign confidence scores to extracted facts
4. THE Memory Extraction SHALL link facts to relevant entities when applicable
5. THE Memory Extraction SHALL include source conversation ID and source message IDs for each extracted fact
6. THE Memory Extraction SHALL preserve temporal context (when the fact was stated)

### Requirement 3

**User Story:** As a developer, I want to extract decisions from conversations, so that I can track choices and conclusions made by users.

#### Acceptance Criteria

1. THE Memory Extraction SHALL identify decision points in conversation messages
2. THE Memory Extraction SHALL extract decision content, rationale, and alternatives considered
3. THE Memory Extraction SHALL assign confidence scores to extracted decisions
4. THE Memory Extraction SHALL link decisions to relevant entities and facts
5. THE Memory Extraction SHALL include source conversation ID and source message IDs for each extracted decision
6. THE Memory Extraction SHALL preserve decision context and timestamp

### Requirement 4

**User Story:** As a developer, I want to extract relationships between memories, so that I can build a knowledge graph of connected information.

#### Acceptance Criteria

1. THE Memory Extraction SHALL identify relationships between extracted memories
2. THE Memory Extraction SHALL assign relationship types (works_at, related_to, depends_on, etc.)
3. THE Memory Extraction SHALL assign confidence scores to relationships
4. THE Memory Extraction SHALL include identifiers linking back to the extracted memories they connect
5. THE Memory Extraction SHALL support bidirectional relationships where appropriate
6. THE Memory Extraction SHALL validate that relationships connect memories within the same workspace

### Requirement 5

**User Story:** As a developer, I want configurable extraction strategies, so that I can tune extraction for different use cases and LLM providers.

#### Acceptance Criteria

1. THE Memory Extraction SHALL support multiple extraction strategies (prompt-based, structured output, function calling)
2. THE Memory Extraction SHALL allow configuration of LLM provider (OpenAI, Anthropic)
3. THE Memory Extraction SHALL allow configuration of model parameters (temperature, max tokens)
4. THE Memory Extraction SHALL allow configuration of memory types to extract
5. THE Memory Extraction SHALL allow configuration of minimum confidence thresholds
6. THE Memory Extraction SHALL support named extraction profiles that bundle strategy, provider, model parameters, memory types, and thresholds

### Requirement 6

**User Story:** As a developer, I want batch extraction for multiple conversations, so that I can efficiently process imported chat history.

#### Acceptance Criteria

1. THE Memory Extraction SHALL process multiple conversations in a single batch operation
2. THE Memory Extraction SHALL deduplicate memories across conversations within the same workspace context
3. THE Memory Extraction SHALL define a consistent strategy for deduplicating memories based on type and normalized key fields
4. THE Memory Extraction SHALL handle extraction failures for individual conversations without failing the entire batch
5. THE Memory Extraction SHALL return extraction results with per-conversation status
6. THE Memory Extraction SHALL support configurable batch size limits

### Requirement 7

**User Story:** As a developer, I want incremental extraction for streaming conversations, so that memories can be extracted as conversations progress.

#### Acceptance Criteria

1. THE Memory Extraction SHALL support incremental extraction as new messages arrive
2. THE Memory Extraction SHALL maintain stable identifiers for memories across incremental extractions
3. THE Memory Extraction SHALL update existing memories when new information is discovered
4. THE Memory Extraction SHALL merge duplicate memories discovered across message chunks
5. THE Memory Extraction SHALL maintain extraction state for ongoing conversations
6. THE Memory Extraction SHALL emit extraction events when new memories are discovered

### Requirement 8

**User Story:** As a developer, I want validation of extracted memories, so that low-quality extractions are filtered out.

#### Acceptance Criteria

1. THE Memory Extraction SHALL validate that extracted memories have required fields (type, content)
2. THE Memory Extraction SHALL validate that confidence scores are between 0 and 1
3. THE Memory Extraction SHALL filter out memories below configured confidence threshold
4. THE Memory Extraction SHALL validate that memory content is not empty or trivial
5. IF validation fails, THEN THE Memory Extraction SHALL log the failure and exclude the memory from results

### Requirement 9

**User Story:** As a developer, I want error handling for LLM failures, so that extraction issues don't crash the application.

#### Acceptance Criteria

1. THE Memory Extraction SHALL handle LLM API failures gracefully
2. THE Memory Extraction SHALL return typed error objects for LLM-related failures, distinguishable from validation or configuration errors
3. THE Memory Extraction SHALL retry failed extractions with exponential backoff
4. THE Memory Extraction SHALL return partial results if some extractions succeed
5. WHEN LLM rate limits are hit, THE Memory Extraction SHALL queue requests for retry
6. THE Memory Extraction SHALL log extraction errors with conversation context

### Requirement 10

**User Story:** As a developer, I want extensible memory types, so that applications can define custom memory categories beyond entities, facts, and decisions.

#### Acceptance Criteria

1. THE Memory Extraction SHALL support registration of custom memory types
2. THE Memory Extraction SHALL allow custom extraction prompts for each memory type
3. THE Memory Extraction SHALL validate custom memory types against configured schema
4. WHERE custom types are registered, THE Memory Extraction SHALL include them in extraction
5. THE Memory Extraction SHALL provide default extraction logic for standard types (entity, fact, decision)
