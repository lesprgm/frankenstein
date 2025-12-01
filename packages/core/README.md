# @memorylayer/core

> **Get started with MemoryLayer in 5 lines of code**

Dead-simple wrapper for building AI apps with persistent memory. Extract knowledge from conversations, search semantically, and build intelligent context—all with a minimal API.

## Quick Start

```typescript
import { MemoryLayer } from '@memorylayer/core';

const ml = new MemoryLayer({ storage: 'sqlite://memory.db' });

await ml.extract("Project Alpha deadline is Q4");
const results = await ml.search("when is the deadline?");
```

That's it. You now have an AI app with memory.

## Why MemoryLayer?

MemoryLayer is a **skeleton framework**—lean, modular packages that give any AI app the ability to remember. It's designed to be:

- **Simple**: 5-line API to get started
- **Modular**: Use what you need, swap what you don't
- **Flexible**: SQLite for local dev, Postgres for production
- **Proven**: Powers both Ghost (blog CMS) and Handoff (conversation manager)

## Installation

```bash
npm install @memorylayer/core
```

Or for advanced usage, install the modular packages:

```bash
npm install @memorylayer/storage @memorylayer/memory-extraction @memorylayer/context-engine
```

## Full API

### Constructor

```typescript
const ml = new MemoryLayer({
  storage: 'sqlite://path.db',  // or full config
  apiKey: process.env.OPENAI_API_KEY,
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.7
});
```

### Extract Memories

```typescript
await ml.extract("We decided to use PostgreSQL", {
  types: ['decision']
});
```

### Search

```typescript
const results = await ml.search("database decisions", {
  limit: 10,
  types: ['decision'],
  includeRelationships: true
});
```

### Build Context

```typescript
const context = await ml.buildContext("summarize project status", {
  tokenBudget: 2000,
  includeRelationships: true
});
```

## Examples

### Hello World
See [examples/hello-world.ts](./examples/hello-world.ts) for the simplest possible example.

### Blog CMS (like Ghost)
See [examples/blog-cms.ts](./examples/blog-cms.ts) for how to use MemoryLayer for semantic content linking.

### Conversation Manager (like Handoff)
See [examples/conversation-manager.ts](./examples/conversation-manager.ts) for knowledge extraction from team chats.

## Advanced Usage

Need more control? Access the underlying packages directly:

```typescript
const storage = ml.getStorage();
const extractor = ml.getExtractor();
const context = ml.getContextEngine();
```

Or use the modular packages directly:

```typescript
import { StorageClient } from '@memorylayer/storage';
import { MemoryExtractor } from '@memorylayer/memory-extraction';
import { ContextEngine } from '@memorylayer/context-engine';
```

## Configuration

### Storage Options

**SQLite (local development)**:
```typescript
{ storage: 'sqlite://memory.db' }
```

**Postgres (production)**:
```typescript
{
  storage: {
    postgres: {
      url: process.env.SUPABASE_URL,
      apiKey: process.env.SUPABASE_KEY
    },
    vectorize: {
      mode: 'cloudflare',
      accountId: process.env.CF_ACCOUNT_ID,
      apiToken: process.env.CF_API_TOKEN,
      indexName: 'memories'
    }
  }
}
```

### Memory Types

Default types: `['entity', 'fact', 'decision']`

Custom types:
```typescript
memoryTypes: ['task', 'requirement', 'bug', 'feature']
```

## Learn More

- [Getting Started Guide](../../docs/GETTING_STARTED.md)
- [Architecture Overview](../../docs/ARCHITECTURE.md)
- [Full Documentation](../README.md)

## Development Approach

The MemoryLayer core packages were developed using Kiro's spec-driven development methodology. Each package has detailed specifications in `.kiro/specs/`:

- `core-storage-layer/` - Storage package specs
- `core-memory-extraction/` - Extraction package specs  
- `core-context-engine/` - Context engine specs
- `core-chat-capture/` - Chat capture specs

See the [root README](../../README.md#development-approach) for complete details on the Kiro spec-driven development process, or check individual package READMEs for package-specific information.

## License

MIT
