# Requirements Document

## Introduction

The Context Engine module provides semantic search over memories and formats relevant context for AI prompts. It combines vector search (via Storage Layer) with ranking, filtering, and context formatting to inject the right memories into conversations. This module enables context-aware AI interactions by retrieving and presenting relevant past information.

## Glossary

- **Context Engine**: The module that searches memories and formats context for AI prompts
- **Semantic Search**: Vector-based similarity search to find relevant memories
- **Context Injection**: Adding relevant memories to AI prompts
- **Ranking**: Ordering search results by relevance and other factors
- **Context Budget**: Maximum tokens/characters allowed for context
- **Context Template**: A formatting pattern for presenting memories in prompts

## Requirements

### Requirement 1

**User Story:** As a developer building on MemoryLayer, I want to search memories by semantic similarity, so that I can find relevant information based on meaning rather than keywords.

#### Acceptance Criteria

1. THE Context Engine SHALL accept a query text and return semantically similar memories
2. THE Context Engine SHALL generate embeddings for query text using configured embedding provider
3. THE Context Engine SHALL perform all memory and relationship lookups via the Storage Layer
4. THE Context Engine SHALL require workspace_id as a parameter for all search operations
5. THE Context Engine SHALL scope all searches to the specified workspace_id
6. THE Context Engine SHALL support filtering by memory type (entity, fact, decision)
7. THE Context Engine SHALL support filtering by date range
8. THE Context Engine SHALL return results with similarity scores

### Requirement 2

**User Story:** As a developer, I want to rank search results by multiple factors, so that the most relevant memories appear first.

#### Acceptance Criteria

1. THE Context Engine SHALL rank results by vector similarity score
2. THE Context Engine SHALL support boosting recent memories in ranking
3. THE Context Engine SHALL support boosting high-confidence memories in ranking
4. THE Context Engine SHALL support custom ranking functions
5. THE Context Engine SHALL apply ranking after vector search and before context formatting

### Requirement 3

**User Story:** As a developer, I want to format search results into context strings, so that I can inject them into AI prompts.

#### Acceptance Criteria

1. THE Context Engine SHALL format memories into human-readable context strings
2. THE Context Engine SHALL use a tokenizer to estimate token counts when available
3. WHERE a tokenizer is not available, THE Context Engine MAY approximate with character counts
4. THE Context Engine SHALL respect token/character budget limits
5. THE Context Engine SHALL prioritize higher-ranked memories when budget is limited
6. THE Context Engine SHALL support configurable context templates
7. THE Context Engine SHALL include memory metadata (type, confidence, timestamp) in formatted output

### Requirement 4

**User Story:** As a developer, I want to include related memories in context, so that users get comprehensive information.

#### Acceptance Criteria

1. THE Context Engine SHALL optionally include memories related to search results
2. WHEN including related memories, THE Context Engine SHALL fetch relationships from Storage Layer
3. THE Context Engine SHALL follow relationships up to configured depth
4. THE Context Engine SHALL deduplicate memories when following relationships
5. THE Context Engine SHALL respect token budget when including related memories

### Requirement 5

**User Story:** As a developer, I want configurable embedding providers, so that I can use different models for vector generation.

#### Acceptance Criteria

1. THE Context Engine SHALL support multiple embedding providers (OpenAI, custom)
2. THE Context Engine SHALL allow configuration of embedding model and dimensions
3. THE Context Engine SHALL cache embeddings keyed by query text and embedding model
4. THE Context Engine SHALL handle embedding generation failures gracefully
5. THE Context Engine SHALL validate embedding dimensions match vector store configuration

### Requirement 6

**User Story:** As a developer, I want hybrid search combining semantic and metadata filters, so that I can find specific types of relevant information.

#### Acceptance Criteria

1. THE Context Engine SHALL combine vector similarity with metadata filtering
2. THE Context Engine SHALL support filtering by memory type before or after vector search
3. THE Context Engine SHALL support filtering by confidence threshold
4. THE Context Engine SHALL support filtering by conversation_id
5. THE Context Engine SHALL support filtering by date range (created_at)

### Requirement 7

**User Story:** As a developer, I want context templates for different use cases, so that memory formatting matches application needs.

#### Acceptance Criteria

1. THE Context Engine SHALL support named context templates (e.g., 'chat', 'summary', 'detailed')
2. THE Context Engine SHALL allow custom template registration
3. THE Context Engine SHALL support template variables (memory content, type, confidence, timestamp)
4. THE Context Engine SHALL support conditional formatting based on memory type
5. THE Context Engine SHALL provide default templates for common use cases

### Requirement 8

**User Story:** As a developer, I want to search without generating new embeddings, so that I can reuse existing memory embeddings for queries.

#### Acceptance Criteria

1. THE Context Engine SHALL accept pre-computed embedding vectors as query input
2. THE Context Engine SHALL skip embedding generation when vector is provided
3. THE Context Engine SHALL validate provided vectors match expected dimensions
4. THE Context Engine SHALL support both text queries and vector queries in the same API
5. THE Context Engine SHALL return the same result format regardless of query type

### Requirement 9

**User Story:** As a developer, I want error handling for search failures, so that context retrieval issues don't crash the application.

#### Acceptance Criteria

1. THE Context Engine SHALL handle embedding generation failures gracefully
2. THE Context Engine SHALL handle vector search failures gracefully
3. THE Context Engine SHALL return typed errors for different failure modes
4. WHEN search fails, THE Context Engine SHALL return empty context rather than throwing
5. THE Context Engine SHALL log search errors with query context

### Requirement 10

**User Story:** As a developer, I want to preview context before injection, so that I can verify what will be sent to the AI.

#### Acceptance Criteria

1. THE Context Engine SHALL provide a method to preview formatted context
2. THE Context Engine SHALL use the same ranking and formatting logic for preview and final context generation
3. THE Context Engine SHALL return token/character count for formatted context
4. THE Context Engine SHALL return list of included memory IDs
5. THE Context Engine SHALL indicate if context was truncated due to budget
6. THE Context Engine SHALL show ranking scores for included memories
