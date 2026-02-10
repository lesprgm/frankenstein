# MemoryLayer Architecture

> A skeleton framework for AI memory—lean, modular, and versatile.

## Overview

MemoryLayer is built as **four independent packages** that work together. Each package is swappable, allowing you to customize your stack.

```
┌─────────────────┐
│   Your App      │
│  (Ghost/Handoff)│
└────────┬────────┘
         │
    ┌────▼─────────────────────────────┐
    │    @memorylayer/core (optional)  │ ← Simple wrapper
    └────┬─────────────────────────────┘
         │
    ┌────▼────────┬──────────┬──────────┐
    │   Storage   │Extraction│ Context  │ ← Modular packages
    └─────────────┴──────────┴──────────┘
```

## The Four Packages

### 1. `@memorylayer/storage`
**What**: Database abstraction layer
**Purpose**: Store memories, relationships, workspaces
**Options**:
- SQLite (local dev)
- PostgreSQL/Supabase (production)
- Vector stores: Local or Cloudflare Vectorize

### 2. `@memorylayer/memory-extraction`
**What**: LLM-powered extraction engine
**Purpose**: Turn text into structured memories
**Key Components**:
- **Strategy Pattern**: Swap between fast single-pass and reliable multi-agent extraction
- **Providers**: OpenAI, Anthropic, Google Gemini
- **Chunking**: Smart semantic chunking for large documents

#### Reliability Layer (MAKER)
Built-in consensus system for high-stakes memory extraction:
- **Micro-agents**: Parallel LLM calls (default: 3 replicas)
- **Consensus**: K-threshold voting to eliminate hallucinations
- **Red-Flagging**: Schema validation and strict filtering
- **Strategies**:
  - `StructuredOutputStrategy`: Fast, single-call (Default)
  - `MakerStrategy`: Multi-agent consensus (High Reliability)

### 3. `@memorylayer/context-engine`
**What**: Semantic search and context building
**Purpose**: Find relevant memories, build AI context
**Features**:
- Vector similarity search
- Relationship traversal
- Templates for formatting

### 4. `@memorylayer/core`
**What**: Simple wrapper (optional)
**Purpose**: 5-line API for quick starts
**When to use**: Prototyping, simple apps
**When not to use**: Need full control, custom configs

## Data Flow

```
Text Input
   │
   ▼
┌──────────────────┐
│  Extraction      │  → Strategy: Single vs Maker (Consensus)
└────────┬─────────┘       ↓
         │            [Micro-agents x3] → [Voting]
         ▼
         │
         ▼
┌──────────────────┐
│  Storage         │  → Store in DB + vector store
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Context Engine  │  → Search, rank, format
└────────┬─────────┘
         │
         ▼
   AI Context
```

## Configuration Options Matrix

| Feature | Ghost (Blog CMS) | Handoff (Conversations) | Your App |
|---------|------------------|-------------------------|----------|
| **Storage** | SQLite | Postgres | ? |
| **Vector Store** | Local | Cloudflare | ? |
| **Memory Types** | topic, reference | entity, fact, decision, task | ? |
| **Context Template** | seo-optimized | conversational | ? |
| **LLM Provider** | OpenAI | OpenAI | ? |

## Same Skeleton, Different Apps

### Ghost Configuration

```typescript
import { MemoryLayer } from '@memorylayer/core';

const ml = new MemoryLayer({
  storage: 'sqlite://ghost.db',       // Local dev
  memoryTypes: ['topic', 'reference'], // Blog-specific
  apiKey: process.env.OPENAI_API_KEY
});
```

**Use Case**: Extract topics from blog posts, find related content

### Handoff Configuration

```typescript
import { MemoryLayer } from '@memorylayer/core';

const ml = new MemoryLayer({
  storage: {
    postgres: { /* ... */ },           // Production
    vectorize: { mode: 'cloudflare' }
  },
  memoryTypes: ['entity', 'fact', 'decision', 'task'], // Team-specific
  apiKey: process.env.OPENAI_API_KEY
});
```

**Use Case**: Extract knowledge from conversations, generate AI briefs

## Modularity in Action

### Example 1: Swap Storage Backend

```typescript
// Development: SQLite
const devConfig = {
  storage: 'sqlite://dev.db'
};

// Production: Postgres
const prodConfig = {
  storage: {
    postgres: { url: process.env.DATABASE_URL }
  }
};
```

**Same code, different backend.**

### Example 2: Swap LLM Provider

```typescript
// Use OpenAI
const extractor = new MemoryExtractor({
  provider: new OpenAIProvider({ apiKey })
});

// Use Anthropic
const extractor = new MemoryExtractor({
  provider: new AnthropicProvider({ apiKey })
});
```

**Same interface, different model.**

### Example 3: Custom Memory Types

```typescript
// Default types
memoryTypes: ['entity', 'fact', 'decision']

// Custom types for your domain
// Custom types for your domain
memoryTypes: ['bug', 'feature', 'requirement', 'meeting-note']
```

**Same extraction, different structure.**

### Example 4: Enable Maker Reliability

```typescript
import { MakerStrategy } from '@memorylayer/memory-extraction';

const extractor = new MemoryExtractor({
  strategy: new MakerStrategy({
    replicas: 3,
    temperature: 0.7
  })
});
```

**Same pipeline, higher reliability.**

## Package Dependencies

```mermaid
graph TD
    A[@memorylayer/core] --> B[@memorylayer/storage]
    A --> C[@memorylayer/memory-extraction]
    A --> D[@memorylayer/context-engine]
    D --> B
    C -.optional.-> B
```

- **Solid arrows**: Required dependencies
- **Dotted arrows**: Optional dependencies
- Each package works independently

## Design Principles

### 1. Lean
Minimal API surface. No bloat.

### 2. Modular  
Use what you need. Swap what you don't.

### 3. Database Agnostic
SQLite, Postgres, or bring your own.

### 4. LLM Agnostic
OpenAI, Anthropic, or custom provider.

### 5. Framework Agnostic
Works with Express, Next.js, Deno, Bun, etc.

## Performance Characteristics

| Operation | SQLite | Postgres |
|-----------|--------|----------|
| Create Memory | 1-5ms | 20-50ms |
| Vector Search (10K) | 10-50ms | 20-100ms |
| Get Memory | <1ms | 10-20ms |
| Relationship Traversal | 5-20ms | 30-100ms |

*Times vary by hardware/network*

## Extending the Skeleton

Want to add your own package?

```typescript
@memorylayer/
  ├── storage           # Core packages
  ├── memory-extraction
  ├── context-engine
  ├── core
  └── your-extension    # Your custom package
```

Just implement the relevant interfaces:
- `StorageAdapter` for new databases
- `LLMProvider` for new models
- `ContextTemplate` for new formats

## Next Steps

- [Getting Started Guide](./GETTING_STARTED.md)
- [Core Package Docs](../packages/core/README.md)
- [Storage Layer Docs](../packages/core/storage/README.md)
- [Extraction Engine Docs](../packages/core/memory-extraction/README.md)
- [Context Engine Docs](../packages/core/context-engine/README.md)
