# @memorylayer/storage

Unified storage layer for MemoryLayer - supports SQLite (local), Supabase Postgres (cloud), and Cloudflare Vectorize (vectors).

## Features

- **Multi-Backend Support**: SQLite, Postgres, or hybrid configurations
- **Vector Search**: Semantic search with Cloudflare Vectorize or local embeddings
- **Workspace Isolation**: Built-in multi-tenancy
- **Type-Safe API**: Full TypeScript support with typed models
- **Transactions**: Atomic operations with automatic rollback
- **Migrations**: Built-in schema versioning and evolution
- **Graph Support**: Memory relationships and traversal

## Installation

```bash
npm install @memorylayer/storage
```

## Quick Start

### SQLite (Local Development)

```typescript
import { StorageClient } from '@memorylayer/storage';

const client = new StorageClient({
  sqlite: {
    filename: './my-memories.db',
  },
  vectorize: {
    mode: 'local', // Uses in-memory vector store
  },
});
```

### Postgres + Vectorize (Production)

```typescript
const client = new StorageClient({
  postgres: {
    url: process.env.SUPABASE_URL!,
    apiKey: process.env.SUPABASE_KEY!,
  },
  vectorize: {
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    indexName: 'memories',
  },
});
```

## Core Operations

### Users & Workspaces

```typescript
// Create user
const user = await client.createUser({
  email: 'user@example.com',
  name: 'John Doe',
});

// Create workspace
const workspace = await client.createWorkspace({
  name: 'My Workspace',
  type: 'personal',
  owner_id: user.value.id,
});

// List workspaces
const workspaces = await client.listUserWorkspaces(userId);
```

### Memories

```typescript
// Create memory with embedding
const memory = await client.createMemory({
  workspace_id: workspaceId,
  conversation_id: conversationId,
  type: 'entity',
  content: 'John works at Acme Corp',
  confidence: 0.95,
  embedding: embeddingVector, // 384-dim vector
});

// Search by semantic similarity
const results = await client.searchMemories(workspaceId, {
  vector: queryEmbedding,
  limit: 10,
  types: ['entity', 'fact'],
  minScore: 0.7,
});

// List with filters
const memories = await client.listMemories(workspaceId, {
  types: ['entity'],
  limit: 50,
  orderBy: 'created_at_desc',
});
```

### Relationships

```typescript
// Create relationship
const rel = await client.createRelationship({
  from_memory_id: memory1Id,
  to_memory_id: memory2Id,
  relationship_type: 'works_at',
  confidence: 0.9,
});

// Get related memories
const related = await client.getMemoryRelationships(
  memoryId,
  workspaceId
);
```

### Transactions

```typescript
const result = await client.transaction(async (tx) => {
  const memory1 = await tx.insert('memories', {...});
  const memory2 = await tx.insert('memories', {...});
  const rel = await tx.insert('relationships', {
    from_memory_id: memory1.id,
    to_memory_id: memory2.id,
    relationship_type: 'related_to',
  });
  
  return { memory1, memory2, rel };
});
```

## Migrations

### CLI Usage

```bash
# Set environment
export DATABASE_URL="https://your-project.supabase.co"
export DATABASE_KEY="your-key"

# Run migrations
npm run migrate up

# Rollback
npm run migrate down

# Check status
npm run migrate status
```

### Programmatic

```typescript
import { MigrationRunner } from '@memorylayer/storage';

const runner = new MigrationRunner({
  url: process.env.DATABASE_URL!,
  apiKey: process.env.DATABASE_KEY!,
});

await runner.up(); // Apply all pending
await runner.status(); // Check current state
```

## Data Models

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface Workspace {
  id: string;
  name: string;
  type: 'personal' | 'team';
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

interface Memory {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  type: string; // 'entity' | 'fact' | 'decision' | custom
  content: string;
  confidence: number; // 0-1
  metadata: Record<string, any>;
  embedding?: number[]; // Vector embedding
  created_at: Date;
  updated_at: Date;
}

interface Relationship {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relationship_type: string;
  confidence: number;
  created_at: Date;
}
```

## Configuration

```typescript
interface StorageConfig {
  // Database backend (choose one or both)
  sqlite?: {
    filename: string;
  };
  postgres?: {
    url: string;
    apiKey: string;
    maxConnections?: number;
  };
  
  // Vector store
  vectorize: {
    mode: 'local' | 'cloudflare';
    accountId?: string;  // Required for cloudflare
    apiToken?: string;   // Required for cloudflare
    indexName?: string;  // Required for cloudflare
  };
  
  // Optional logger
  logger?: {
    error(msg: string, ctx?: object): void;
    warn(msg: string, ctx?: object): void;
    info(msg: string, ctx?: object): void;
  };
}
```

## Error Handling

All operations return `Result<T, StorageError>`:

```typescript
const result = await client.getMemory(memoryId, workspaceId);

if (!result.ok) {
  switch (result.error.type) {
    case 'not_found':
      console.error('Not found:', result.error.id);
      break;
    case 'validation':
      console.error('Invalid:', result.error.message);
      break;
    case 'database':
      console.error('DB error:', result.error.message);
      break;
    case 'vector_store':
      console.error('Vector error:', result.error.message);
      break;
  }
} else {
  console.log('Memory:', result.value);
}
```

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

Requires Supabase and Vectorize credentials:

```bash
# Setup
cp .env.test.example .env.test
# Fill in .env.test with credentials

# Run
source .env.test
npm test -- integration.test.ts
```

See [Test Documentation](./src/__tests__/README.md) for details.

## Performance

| Operation | SQLite | Postgres |
|-----------|--------|----------|
| Create Memory | ~1-5ms | ~20-50ms |
| Vector Search (10K memories) | ~10-50ms | ~20-100ms |
| Get Memory | ~1ms | ~10-20ms |
| List Memories (50) | ~2-10ms | ~20-50ms |

*Times are approximate and vary by hardware/network*

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Watch
npm run test:watch
```

## License

MIT
