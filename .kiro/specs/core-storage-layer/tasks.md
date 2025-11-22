# Implementation Plan

- [x] 1. Set up project structure and core types
  - Create `packages/core/storage/` directory with package.json and tsconfig.json
  - Define all TypeScript interfaces in `src/models.ts` (User, Workspace, Conversation, Message, Memory, Relationship)
  - Define error types and Result type in `src/errors.ts`
  - Define filter interfaces (ConversationFilters, MemoryFilters, SearchQuery) in `src/models.ts`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2_

- [x] 2. Create database migration files
  - Write SQL migration `001_initial_schema.sql` with all table definitions
  - Include CREATE TABLE statements for users, workspaces, workspace_members, conversations, messages, memories, relationships
  - Add CHECK constraints for type fields and confidence ranges
  - Add all indexes for workspace_id, conversation_id, and timestamp fields
  - Add foreign key constraints with appropriate CASCADE rules
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 3. Implement PostgresAdapter
  - Create `src/postgres.ts` with PostgresAdapter class
  - Implement constructor that initializes Supabase client from config
  - Implement `query<T>()` method for raw SQL queries with parameter binding
  - Implement `insert<T>()` method with RETURNING clause
  - Implement `update<T>()` method with RETURNING clause
  - Implement `delete()` method
  - Implement `beginTransaction()` method that returns Transaction object
  - Add error handling that converts Postgres errors to StorageError types
  - _Requirements: 1.1, 1.2, 1.4, 5.1, 5.2, 5.3, 5.4, 6.3_

- [x] 4. Implement VectorizeAdapter
  - Create `src/vectorize.ts` with VectorizeAdapter class
  - Implement constructor that initializes Vectorize client from config
  - Implement `upsert()` method that stores vector with metadata (workspace_id, type)
  - Implement `search()` method that queries by vector with metadata filters
  - Implement `delete()` method that removes vector by ID
  - Add error handling that converts Vectorize errors to StorageError types
  - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 6.3_

- [x] 5. Implement StorageClient - User and Workspace operations
  - Create `src/client.ts` with StorageClient class
  - Implement constructor that initializes PostgresAdapter, VectorizeAdapter, and optional logger
  - Implement `createUser()` with validation and error handling
  - Implement `getUser()` with not-found handling
  - Implement `createWorkspace()` with type validation (personal/team)
  - Implement `getWorkspace()` with not-found handling
  - Implement `listUserWorkspaces()` that queries by owner_id
  - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 6.1, 6.2, 6.4_

- [x] 6. Implement StorageClient - Conversation operations
  - Implement `createConversation()` with workspace_id validation
  - Implement `getConversation()` with workspace scoping check
  - Implement `listConversations()` with workspace scoping, pagination (limit/offset), and ordering
  - Add validation to ensure conversation belongs to specified workspace
  - _Requirements: 1.1, 1.3, 1.5, 2.3, 3.1, 3.2, 3.3, 3.4_

- [x] 7. Implement StorageClient - Memory operations (CRUD)
  - Implement `createMemory()` with workspace_id validation and optional embedding handling
  - When embedding is provided, call `vectorize.upsert()` after Postgres insert
  - Implement `getMemory()` with workspace scoping check
  - Implement `listMemories()` with workspace scoping, type filtering, pagination, and ordering
  - Implement `deleteMemory()` that removes from both Postgres and Vectorize
  - Add logging for embedding lifecycle operations
  - _Requirements: 1.1, 1.3, 1.5, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 6.4, 6.5_

- [x] 8. Implement StorageClient - Semantic search
  - Implement `searchMemories()` with explicit workspace_id parameter
  - Query Vectorize with query vector and workspace_id metadata filter
  - Apply optional type filters and date range filters in Vectorize query
  - Fetch full memory records from Postgres for matching IDs
  - Return SearchResult array with memory objects and similarity scores
  - Handle pagination with limit parameter
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.3, 4.4, 4.5_

- [x] 9. Implement StorageClient - Relationship operations
  - Implement `createRelationship()` with workspace boundary validation
  - Query both from_memory_id and to_memory_id to verify same workspace
  - Return validation error if memories belong to different workspaces
  - Implement `getMemoryRelationships()` with workspace scoping via JOIN on memories table
  - Ensure all returned relationships respect workspace boundaries
  - _Requirements: 1.1, 1.3, 1.5, 2.5, 3.1, 3.2, 3.3, 3.4_

- [x] 10. Implement transaction support
  - Implement `transaction()` method that accepts callback function
  - Begin Postgres transaction, execute callback with transaction context
  - Commit on success, rollback on error
  - Wrap transaction errors in StorageError type
  - Add logging for transaction lifecycle events
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.4_

- [x] 11. Implement migration runner
  - Create `src/migrations/migration-runner.ts` with MigrationRunner class
  - Implement method to read and execute SQL migration files in order
  - Create migrations tracking table to record applied migrations
  - Implement up migration (apply new migrations)
  - Implement down migration (rollback migrations)
  - Add CLI script to run migrations
  - _Requirements: 7.1, 7.4, 7.5_

- [x] 12. Write unit tests for adapters
  - Write unit tests for PostgresAdapter with mocked Supabase client
  - Write unit tests for VectorizeAdapter with mocked Vectorize client
  - Test error handling for connection failures, query errors, and validation errors
  - Test Result type wrapping for all operations
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 13. Write integration tests for StorageClient
  - Set up test Supabase database and Vectorize index
  - Write integration tests for user and workspace CRUD operations
  - Write integration tests for conversation operations with workspace scoping
  - Write integration tests for memory operations with embedding lifecycle
  - Write integration tests for semantic search with actual embeddings
  - Write integration tests for relationship operations with workspace validation
  - Write integration tests for transaction rollback scenarios
  - Test concurrent operations and race conditions
  - Clean up test data after each test
  - _Requirements: 3.4, 4.5, 5.2, 5.3_
