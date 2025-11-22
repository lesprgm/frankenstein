# Storage Layer Design

## Overview

The Storage Layer provides a clean abstraction over Supabase Postgres and Cloudflare Vectorize. It exposes a single `StorageClient` class that handles all database operations with type safety, workspace scoping, and error handling. The design prioritizes simplicity and reusability across both Handoff and Hive Mind applications.

## Architecture

### Component Structure

```
packages/core/storage/
├── src/
│   ├── client.ts           # Main StorageClient class
│   ├── models.ts           # TypeScript types for all data models
│   ├── postgres.ts         # Postgres operations wrapper
│   ├── vectorize.ts        # Vectorize operations wrapper
│   ├── errors.ts           # Custom error types
│   └── migrations/         # SQL migration files
│       ├── 001_initial_schema.sql
│       └── migration-runner.ts
├── package.json
└── tsconfig.json
```

### Key Design Decisions

1. **Single Client Interface**: `StorageClient` is the only public API. It internally delegates to `PostgresAdapter` and `VectorizeAdapter`.

2. **Workspace-First Queries**: All query methods require `workspace_id` to enforce isolation. This makes it impossible to accidentally leak data across workspaces.

3. **Separate Vector Store**: Embeddings live in Vectorize, not Postgres. Memory metadata stays in Postgres with a reference. This keeps the relational model clean and leverages Vectorize's optimized vector search.

4. **Result Types Over Exceptions**: Methods return `Result<T, StorageError>` instead of throwing. This makes error handling explicit and type-safe.

## Components and Interfaces

### StorageClient

The main entry point for all storage operations.

```typescript
class StorageClient {
  constructor(config: StorageConfig)
  
  // User operations
  async createUser(data: CreateUserInput): Promise<Result<User, StorageError>>
  async getUser(id: string): Promise<Result<User | null, StorageError>>
  
  // Workspace operations
  async createWorkspace(data: CreateWorkspaceInput): Promise<Result<Workspace, StorageError>>
  async getWorkspace(id: string): Promise<Result<Workspace | null, StorageError>>
  async listUserWorkspaces(userId: string): Promise<Result<Workspace[], StorageError>>
  
  // Conversation operations
  async createConversation(data: CreateConversationInput): Promise<Result<Conversation, StorageError>>
  async getConversation(id: string, workspaceId: string): Promise<Result<Conversation | null, StorageError>>
  async listConversations(workspaceId: string, filters?: ConversationFilters): Promise<Result<Conversation[], StorageError>>
  
  // Memory operations
  async createMemory(data: CreateMemoryInput): Promise<Result<Memory, StorageError>>
  async getMemory(id: string, workspaceId: string): Promise<Result<Memory | null, StorageError>>
  async listMemories(workspaceId: string, filters?: MemoryFilters): Promise<Result<Memory[], StorageError>>
  async searchMemories(workspaceId: string, query: SearchQuery): Promise<Result<SearchResult[], StorageError>>
  async deleteMemory(id: string, workspaceId: string): Promise<Result<void, StorageError>>
  
  // Relationship operations
  async createRelationship(data: CreateRelationshipInput): Promise<Result<Relationship, StorageError>>
  async getMemoryRelationships(memoryId: string, workspaceId: string): Promise<Result<Relationship[], StorageError>>
  
  // Transaction support
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<Result<T, StorageError>>
}
```

### Configuration

```typescript
interface StorageConfig {
  postgres: {
    url: string
    maxConnections?: number
  }
  vectorize: {
    accountId: string
    apiToken: string
    indexName: string
  }
  logger?: Logger // Optional logger for internal errors
}

interface Logger {
  error(message: string, context?: object): void
  warn(message: string, context?: object): void
  info(message: string, context?: object): void
}
```

### Query Filters and Pagination

```typescript
interface ConversationFilters {
  limit?: number
  offset?: number
  orderBy?: 'created_at_asc' | 'created_at_desc'
}

interface MemoryFilters {
  limit?: number
  offset?: number
  types?: MemoryType[]
  orderBy?: 'created_at_asc' | 'created_at_desc'
}

interface SearchQuery {
  vector: number[]
  limit?: number
  types?: MemoryType[]
  dateFrom?: Date
  dateTo?: Date
}

interface SearchResult {
  memory: Memory
  score: number
}
```

### PostgresAdapter

Internal adapter for Postgres operations using Supabase client.

```typescript
class PostgresAdapter {
  constructor(config: PostgresConfig)
  
  async query<T>(sql: string, params: any[]): Promise<T[]>
  async insert<T>(table: string, data: object): Promise<T>
  async update<T>(table: string, id: string, data: object): Promise<T>
  async delete(table: string, id: string): Promise<void>
  async beginTransaction(): Promise<Transaction>
}
```

### VectorizeAdapter

Internal adapter for Cloudflare Vectorize operations.

```typescript
class VectorizeAdapter {
  constructor(config: VectorizeConfig)
  
  async upsert(id: string, vector: number[], metadata: object): Promise<void>
  async search(vector: number[], limit: number, filter?: object): Promise<VectorSearchResult[]>
  async delete(id: string): Promise<void>
}

interface VectorSearchResult {
  id: string
  score: number
  metadata: object
}
```

## Data Models

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspaces table
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace members (for team workspaces)
CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memories table
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('entity', 'fact', 'decision')),
  content TEXT NOT NULL,
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationships table
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_memories_workspace ON memories(workspace_id);
CREATE INDEX idx_memories_conversation ON memories(conversation_id);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_relationships_from ON relationships(from_memory_id);
CREATE INDEX idx_relationships_to ON relationships(to_memory_id);
```

### TypeScript Models

```typescript
interface User {
  id: string
  email: string
  name: string
  created_at: Date
  updated_at: Date
}

interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  owner_id: string
  created_at: Date
  updated_at: Date
}

interface Conversation {
  id: string
  workspace_id: string
  provider: string
  external_id: string | null
  title: string | null
  created_at: Date
  updated_at: Date
}

interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: Date
}

// Memory types: extensible for future apps via migrations
type MemoryType = 'entity' | 'fact' | 'decision' | string

interface Memory {
  id: string
  workspace_id: string
  conversation_id: string | null
  type: MemoryType
  content: string
  confidence: number
  metadata: Record<string, any>
  created_at: Date
  updated_at: Date
}

interface Relationship {
  id: string
  from_memory_id: string
  to_memory_id: string
  relationship_type: string
  confidence: number
  created_at: Date
}
```

## Embeddings Lifecycle

The Storage Layer manages the lifecycle of embeddings in Vectorize:

1. **Create Memory with Embedding**: When `createMemory` receives an embedding in `CreateMemoryInput`, it:
   - Inserts the memory record into Postgres
   - Calls `vectorize.upsert(memory.id, embedding, metadata)` with workspace_id and type in metadata
   - Returns error if either operation fails

2. **Update Memory Embedding**: When `updateMemory` receives a new embedding:
   - Updates the memory record in Postgres
   - Calls `vectorize.upsert(memory.id, newEmbedding, metadata)` to replace the vector
   
3. **Delete Memory**: When `deleteMemory` is called:
   - Deletes the memory record from Postgres (cascades to relationships)
   - Calls `vectorize.delete(memory.id)` to remove the embedding
   - Both operations succeed or both fail (transaction-like behavior)

4. **Search Memories**: When `searchMemories` is called:
   - Queries Vectorize with the query vector and workspace_id filter
   - Retrieves matching memory IDs and scores
   - Fetches full memory records from Postgres
   - Returns combined results with scores

## Relationship Workspace Invariant

All relationships must respect workspace boundaries:

- Both `from_memory_id` and `to_memory_id` must belong to the same workspace
- When querying relationships via `getMemoryRelationships`, the query joins on `memories.workspace_id = workspaceId`
- This is enforced at the query level, not just by foreign keys
- Attempting to create a cross-workspace relationship returns a validation error

## Logging Strategy

The Storage Layer uses an optional logger for internal error tracking:

- **Internal errors** (database failures, connection issues) are logged with full context
- **Caller-facing errors** (via `StorageError`) contain sanitized messages without internal details
- Default implementation uses `console.error` if no logger is provided
- Apps can inject custom loggers (e.g., structured logging to external services)

Example:
```typescript
// Internal: logged with full context
logger.error('Postgres query failed', { query, params, error: dbError })

// External: sanitized error returned to caller
return { ok: false, error: { type: 'database', message: 'Failed to query memories' } }
```

## Error Handling

### Error Types

```typescript
type StorageError =
  | { type: 'not_found'; resource: string; id: string }
  | { type: 'validation'; field: string; message: string }
  | { type: 'conflict'; message: string }
  | { type: 'database'; message: string; cause?: unknown }
  | { type: 'vector_store'; message: string; cause?: unknown }

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

### Error Handling Pattern

```typescript
const result = await storageClient.getMemory(memoryId, workspaceId)

if (!result.ok) {
  switch (result.error.type) {
    case 'not_found':
      return res.status(404).json({ error: 'Memory not found' })
    case 'validation':
      return res.status(400).json({ error: result.error.message })
    default:
      return res.status(500).json({ error: 'Internal server error' })
  }
}

const memory = result.value
```

## Testing Strategy

### Unit Tests

- Test each adapter (Postgres, Vectorize) in isolation with mocked clients
- Test error handling for all failure scenarios
- Test workspace scoping enforcement
- Test transaction rollback behavior

### Integration Tests

- Test against real Supabase instance (test database)
- Test against Vectorize test index
- Test full CRUD operations for all models
- Test vector search with actual embeddings
- Test concurrent operations and race conditions

### Test Data

- Use factory functions to generate test data
- Create fixtures for common scenarios (personal workspace, team workspace)
- Clean up test data after each test run
