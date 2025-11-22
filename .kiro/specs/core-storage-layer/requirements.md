# Requirements Document

## Introduction

The Storage Layer provides a unified abstraction over Supabase Postgres and Cloudflare Vectorize for the MemoryLayer skeleton. It defines the core data models (users, workspaces, conversations, memories, relationships) and provides type-safe CRUD operations. This layer must support both single-user (Handoff) and multi-user (Hive Mind) workspace models through flexible scoping.

## Glossary

- **Storage Layer**: The module that abstracts database operations for Postgres and Vectorize
- **Workspace**: A logical container for conversations and memories (personal or team)
- **Memory**: An extracted piece of information (entity, fact, or decision) from a conversation
- **Relationship**: A typed connection between two memories (e.g., "person works_at organization")
- **Embedding**: A vector representation of text for semantic search
- **Supabase**: The Postgres database provider
- **Vectorize**: Cloudflare's vector database for embeddings

## Requirements

### Requirement 1

**User Story:** As a developer building on MemoryLayer, I want a unified storage interface, so that I can persist and retrieve data without managing database-specific code.

#### Acceptance Criteria

1. THE Storage Layer SHALL provide a single interface for all database operations
2. THE Storage Layer SHALL support both Postgres operations and vector operations through the same API
3. THE Storage Layer SHALL use TypeScript types for all data models
4. THE Storage Layer SHALL handle connection management and error handling internally
5. THE Storage Layer SHALL expose async methods that return typed results or errors

### Requirement 2

**User Story:** As a developer, I want clear data models for users, workspaces, conversations, and memories, so that both Handoff and Hive Mind can use the same schema.

#### Acceptance Criteria

1. THE Storage Layer SHALL define a User model with id, email, name, and timestamps
2. THE Storage Layer SHALL define a Workspace model with id, name, type (personal or team), owner_id, and timestamps
3. THE Storage Layer SHALL define a Conversation model with id, workspace_id, provider, external_id, title, and timestamps
4. THE Storage Layer SHALL define a Memory model with id, workspace_id, conversation_id, type (entity, fact, decision), content, confidence, and timestamps
5. THE Storage Layer SHALL define a Relationship model with id, from_memory_id, to_memory_id, relationship_type, and confidence

### Requirement 3

**User Story:** As a developer, I want workspace-scoped queries, so that personal and team memories remain isolated.

#### Acceptance Criteria

1. WHEN querying conversations, THE Storage Layer SHALL filter by workspace_id
2. WHEN querying memories, THE Storage Layer SHALL filter by workspace_id
3. THE Storage Layer SHALL provide methods that accept workspace_id as a required parameter
4. THE Storage Layer SHALL prevent cross-workspace data access through query constraints
5. WHERE a user has access to multiple workspaces, THE Storage Layer SHALL support querying across specified workspace_ids

### Requirement 4

**User Story:** As a developer, I want to store and search embeddings, so that I can implement semantic search over memories.

#### Acceptance Criteria

1. THE Storage Layer SHALL store embeddings in Cloudflare Vectorize with memory_id as metadata
2. WHEN storing a memory, THE Storage Layer SHALL accept an optional embedding vector
3. THE Storage Layer SHALL provide a vector search method that accepts a query vector and workspace_id
4. THE Storage Layer SHALL return search results with similarity scores and memory metadata
5. THE Storage Layer SHALL support filtering vector search by memory type and date range

### Requirement 5

**User Story:** As a developer, I want transaction support for complex operations, so that I can maintain data consistency.

#### Acceptance Criteria

1. THE Storage Layer SHALL support database transactions for multi-step operations
2. WHEN creating a memory with relationships, THE Storage Layer SHALL use a transaction to ensure atomicity
3. IF a transaction step fails, THEN THE Storage Layer SHALL roll back all changes
4. THE Storage Layer SHALL provide a transaction wrapper method that accepts a callback function
5. THE Storage Layer SHALL handle transaction lifecycle (begin, commit, rollback) automatically

### Requirement 6

**User Story:** As a developer, I want clear error handling, so that I can respond appropriately to storage failures.

#### Acceptance Criteria

1. THE Storage Layer SHALL return typed error objects for all failure cases
2. THE Storage Layer SHALL distinguish between not-found errors, validation errors, and system errors
3. WHEN a database operation fails, THE Storage Layer SHALL include the operation context in the error
4. THE Storage Layer SHALL log errors with sufficient detail for debugging
5. THE Storage Layer SHALL NOT expose internal database error messages to calling code

### Requirement 7

**User Story:** As a developer, I want migration support, so that I can evolve the schema over time.

#### Acceptance Criteria

1. THE Storage Layer SHALL include SQL migration files for initial schema setup
2. THE Storage Layer SHALL define indexes for workspace_id, conversation_id, and timestamp fields
3. THE Storage Layer SHALL define foreign key constraints to maintain referential integrity
4. THE Storage Layer SHALL include a migration runner that tracks applied migrations
5. THE Storage Layer SHALL support both up and down migrations for schema changes
