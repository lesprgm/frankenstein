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

## Memory Lifecycle Management

MemoryLayer includes automatic memory lifecycle management to keep your memory store relevant, performant, and storage-efficient.

### Features

- **Time-Based Decay**: Memories decay over time, prioritizing recent information
- **Importance Scoring**: Frequently accessed memories persist longer
- **Automatic Archival**: Inactive memories move to cold storage
- **Configurable Retention**: Per-memory-type TTL policies
- **Pinned Memories**: Manual override to prevent archival
- **Background Jobs**: Automated evaluation and cleanup

### Lifecycle States

Memories transition through these states:

- **active**: Fresh, frequently accessed memories
- **decaying**: Memories with low decay score (visual indicator, still searchable)
- **archived**: Moved to cold storage (retrievable via `includeArchived` flag)
- **expired**: Past retention period, eligible for deletion
- **pinned**: Manually preserved, exempt from automatic transitions

### Quick Start

```typescript
import { LifecycleManager } from '@memorylayer/storage';

// Initialize lifecycle manager
const lifecycleManager = new LifecycleManager(
  storageAdapter,
  vectorizeAdapter,
  {
    enabled: true,
    defaultTTL: 90 * 24 * 60 * 60 * 1000, // 90 days
    decayFunction: DECAY_FUNCTIONS.exponential(0.1),
    decayThreshold: 0.5,
    importanceWeights: {
      accessFrequency: 0.4,
      confidence: 0.3,
      relationshipCount: 0.3,
    },
    evaluationInterval: 60 * 60 * 1000, // 1 hour
    batchSize: 100,
    archiveRetentionPeriod: 365 * 24 * 60 * 60 * 1000, // 1 year
    auditRetentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
    retentionPolicies: new Map([
      ['entity', { ttl: 180 * 24 * 60 * 60 * 1000, importanceMultiplier: 2.0, gracePeriod: 7 * 24 * 60 * 60 * 1000 }],
      ['fact', { ttl: 60 * 24 * 60 * 60 * 1000, importanceMultiplier: 1.5, gracePeriod: 3 * 24 * 60 * 60 * 1000 }],
    ]),
  }
);

// Start background jobs
lifecycleManager.startBackgroundJobs();
```

### Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `enabled` | boolean | Enable lifecycle management | `true` |
| `defaultTTL` | number | Default time-to-live (ms) | 90 days |
| `decayFunction` | DecayFunction | Time-based decay algorithm | exponential(0.1) |
| `decayThreshold` | number | Threshold for decaying state (0-1) | 0.5 |
| `importanceWeights` | ImportanceWeights | Weights for importance scoring | See below |
| `evaluationInterval` | number | Background job frequency (ms) | 1 hour |
| `batchSize` | number | Memories per batch (1-10000) | 100 |
| `archiveRetentionPeriod` | number | Archive retention before expiry (ms) | 1 year |
| `auditRetentionPeriod` | number | Lifecycle event retention (ms) | 30 days |
| `retentionPolicies` | Map | Per-type TTL policies | empty |

**ImportanceWeights**:
- `accessFrequency` (0-1): Weight for access frequency
- `confidence` (0-1): Weight for confidence score
- `relationshipCount` (0-1): Weight for relationship count

### Usage Examples

#### Pinning Memories

```typescript
// Pin a critical memory to prevent archival
await storageClient.updateMemoryLifecycle(memoryId, workspaceId, {
  pinned: true,
});

// Unpin a memory
await storageClient.updateMemoryLifecycle(memoryId, workspaceId, {
  pinned: false,
});
```

#### Searching Archived Memories

```typescript
// Include archived memories in search
const results = await storageClient.searchMemories(workspaceId, {
  vector: queryEmbedding,
  limit: 10,
  includeArchived: true, // Search both active and archived
});
```

#### Querying by Lifecycle State

```typescript
// Get all decaying memories
const decaying = await storageClient.getMemoriesByLifecycleState(
  workspaceId,
  'decaying',
  { limit: 50, offset: 0 }
);

// Get all pinned memories
const pinned = await storageClient.getMemoriesByLifecycleState(
  workspaceId,
  'pinned',
  { limit: 100 }
);
```

#### Manual State Transitions

```typescript
// Manually archive a memory
await storageClient.updateMemoryLifecycle(memoryId, workspaceId, {
  lifecycle_state: 'archived',
});

// Restore archived memory to active
await storageClient.updateMemoryLifecycle(memoryId, workspaceId, {
  lifecycle_state: 'active',
});
```

#### Metrics & Monitoring

```typescript
// Get lifecycle metrics for a workspace
const metricsResult = await lifecycleManager.getMetrics(workspaceId);

if (metricsResult.ok) {
  const metrics = metricsResult.value;
  console.log('Total memories:', metrics.totalMemories);
  console.log('Pinned memories:', metrics.pinnedMemories);
  console.log('State counts:', metrics.stateCounts);
  console.log('Average decay score:', metrics.averageDecayScore);
  console.log('Storage by state:', metrics.storageByState);
}
```

### Decay Functions

Built-in decay functions:

```typescript
import { DECAY_FUNCTIONS } from '@memorylayer/storage';

// Exponential decay (recommended)
const expDecay = DECAY_FUNCTIONS.exponential(0.1); // lambda: decay rate

// Linear decay
const linearDecay = DECAY_FUNCTIONS.linear(90 * 24 * 60 * 60 * 1000); // decay period

// Step decay
const stepDecay = DECAY_FUNCTIONS.step(
  [7 * 24 * 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000], // intervals
  [1.0, 0.5] // scores
);
```

### Best Practices

1. **Set Appropriate TTLs**: Configure per-type retention policies based on your use case
2. **Monitor Metrics**: Regularly check lifecycle metrics to optimize settings
3. **Pin Critical Data**: Use pinning for memories that should never be archived
4. **Adjust Decay Rates**: Tune decay function parameters based on access patterns
5. **Enable Background Jobs**: Ensure lifecycle manager is started in production

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

## Development Approach

This package was developed using Kiro's spec-driven development methodology:

### Spec-Driven Development with Kiro

The `.kiro/specs/core-storage-layer/` directory contains detailed specifications:

- **requirements.md** - Core requirements including workspace scoping, multi-backend support, and vector search
- **design.md** - Complete architecture including `StorageClient` API, database schema, and error handling patterns
- **tasks.md** - Granular implementation task breakdown

### Key Spec-Driven Decisions

1. **Result Types Over Exceptions**: The spec defined `Result<T, StorageError>` pattern for explicit error handling
2. **Workspace-First Design**: All query methods require `workspace_id` to enforce isolation
3. **Separate Vector Store**: Embeddings in Vectorize, metadata in Postgres/SQLite
4. **Single Client Interface**: `StorageClient` as the only public API, internally delegating to adapters

### Development Process

1. **Spec Creation**: Defined complete storage layer API, data models, and backend adapters
2. **AI-Assisted Implementation**: ~80% of initial implementation generated from specs using Kiro
3. **Manual Refinement**: Added comprehensive tests, migrations, and production optimizations

This approach enabled rapid prototyping while maintaining consistent APIs and clear separation of concerns.

## License

MIT
