# MemoryLayer

**A skeleton framework for building AI apps with persistent memory.**

MemoryLayer is a lean, modular memory stack that gives any AI application the ability to remember. Four focused packages provide everything you need: capture conversations, extract knowledge, store in SQL+vectors, and build intelligent context.

[![Watch the MemoryLayer demo](https://img.youtube.com/vi/Vx8o01rarzM/hqdefault.jpg)](https://youtu.be/Vx8o01rarzM)

## Hello World (5 Lines)

```typescript
import { MemoryLayer } from '@memorylayer/core';

const ml = new MemoryLayer({ storage: 'sqlite://memory.db' });
await ml.extract("Project Alpha deadline is Q4 2024");
const results = await ml.search("when is the deadline?");
// Returns: "Project Alpha deadline is Q4 2024"
```

That's it. Deploy anywhere (SQLite local, Postgres cloud), swap any piece (database, LLM, embeddings), and build your own use case.

**Proven in production**: Powers both [Ghost](apps/ghost) (blog CMS) and [Handoff](apps/handoff-frontend) (conversation manager)—two completely different apps built on the same skeleton.

[Getting Started](docs/GETTING_STARTED.md) | [Architecture](docs/ARCHITECTURE.md) | [Core Package](packages/core/README.md)

---

## Why MemoryLayer?

Instead of building bespoke "memory code" in every AI app, you get a small set of well‑typed packages for:
- **Capturing** conversations and events from different sources
- **Extracting** structured memories (entities, facts, decisions)  
- **Storing** and searching in SQL + vectors
- **Assembling** context windows for LLM calls

You can use it to power personal agents, team workspaces, support tools, or any app that needs durable, searchable AI memory.

---

## What Makes MemoryLayer Different

Unlike existing memory solutions, MemoryLayer is **actually proven** with two production apps and offers features nobody else combines:

### Unique Features

1. **SQLite + Postgres with Same Code**
   - Dev: `storage: 'sqlite://dev.db'`
   - Prod: `storage: { postgres: {...} }`
   - No rewrites, no adapter hell

2. **100% Local-First**
   - Runs completely offline (SQLite + local embeddings)
   - No cloud dependencies required
   - **Proven**: Ghost desktop app works with zero internet

3. **Two Production Apps, Same Foundation**
   - Ghost: Blog CMS with semantic linking
   - Handoff: Team workspace with AI briefs
   - Zero shared application code

4. **Smart Conversation Chunking**
   - Handles 200K+ token conversations
   - Automatic chunking with overlap
   - Token-accurate counting (tiktoken)

5. **Custom Memory Types**
   - Extend beyond entity/fact/decision
   - Ghost: `['topic', 'reference']`
   - Handoff: `['task', 'decision']`
   - Your app: `['bug', 'feature', 'customer']`

6. **MAKER Reliability Layer** (NEW)
   - Multi-agent consensus for robust extraction
   - 3 parallel Gemini 2.0 Flash Lite calls + voting
   - Graceful fallback on failures
   - 51 tests (22 unit + 7 integration + 15 stress)

7. **True Modularity**
   - Use just storage (SQL client only)
   - Add context-engine (semantic search)
   - Add extraction when ready (LLM costs)
   - Or use `@memorylayer/core` for all-in-one


**Bottom line**: MemoryLayer is the only solution that's local-first, database-agnostic, AND proven with multiple production apps.

---

## MAKER Reliability Layer

**NEW**: MAKER (Multi-Agent Knowledge Extraction & Refinement) enhances memory extraction through parallel microagents, validation, and consensus voting.

### How It Works

1. **Microagents**: Launches 3 parallel Gemini 2.0 Flash Lite calls with identical prompts
2. **Red-Flagging**: Validates each response (schema checks, content quality)
3. **Voting**: Selects consensus result based on decision/todo overlap
4. **Graceful Fallback**: Returns null if all agents fail

**Benefits**:
- Improved reliability through redundancy
- Error correction via consensus voting
- Minimal latency overhead (parallel execution)
- Low cost with Gemini 2.0 Flash Lite

**Configuration** (environment variables):
```bash
MAKER_ENABLED=true              # Enable/disable MAKER
MAKER_REPLICAS=3                # Number of parallel microagents
MAKER_TEMPERATURE=0.4           # LLM temperature
MAKER_MODEL=gemini-2.0-flash-lite # Model to use
```

**Test Coverage**: 51 tests (all passing)
- 22 unit tests (validation, voting, orchestration)
- 7 integration tests (full E2E flow)
- 15 stress tests (100 sequential, 50 concurrent, failure modes)
- 7 existing suite tests

See [`packages/core/memory-extraction`](./packages/core/memory-extraction/README.md) for detailed documentation.

---

## The Problem

Once you go beyond "toy chatbot", almost every AI product needs some version of a **memory stack**:

- Ingest conversations, tickets, logs, or notes from different sources.
- Run LLMs to extract entities, facts, decisions, and relationships.
- Store that graph with embeddings so you can search it semantically.
- Assemble a compact, token‑bounded context window for each new LLM call.

This shows up in lots of places:
- personal agents and copilots ("remember what I asked last week"),
- team knowledge tools and workspaces,
- incident/ops copilots,
- support and customer success tools,
- research or learning notebooks.

Today, most teams rebuild this stack themselves:
- 4–6+ weeks of engineering,
- tightly coupled to a specific provider or framework,
- and bespoke designs that are hard to reuse in the next app.

Existing solutions tend to be:
- **Provider‑locked** – tied to a single LLM or vendor's APIs.
- **Cloud‑only** – difficult to run locally or on your own infra.
- **Monolithic** – you have to adopt the whole framework instead of just storage or just context.

If you want:
- a slim storage + search layer for memories,
- plus a context engine,
- plus a flexible extraction pipeline,

you usually end up writing it yourself.

---

## The Skeleton

MemoryLayer is **intentionally minimal**—a skeleton you flesh out for your needs:

| Package | Purpose | Swap It |
|---------|---------|---------|
| **chat-capture** | Normalize logs from providers | Custom parsers |
| **memory-extraction** | Extract structured knowledge | Different LLMs, custom types |
| **storage** | SQL + vector persistence | SQLite ↔ Postgres, local ↔ cloud vectors |
| **context-engine** | Semantic search + context building | Custom ranking, templates |

Mix and match. Use one package or all four. Change what you want.

**Same skeleton, different apps:**
- **Ghost** (local blog CMS): SQLite + local vectors + topic extraction  
- **Handoff** (team workspace): Postgres + Cloudflare vectors + task extraction

Both were built on the same foundation with zero code duplication.

**Key properties:**

- **Deploy anywhere** – SQLite locally or Postgres in the cloud  
- **Modular** – use what you need, swap what you don't  
- **Model-agnostic** – OpenAI, Anthropic, Gemini, or your own provider  
- **Framework-agnostic** – works with Express, Next.js, Deno, Bun, plain Node

---

## Capabilities

- **Chat capture (`packages/core/chat-capture`)**
  - Normalize conversations from different providers/log formats into a common schema.
  - Support both static exports and live/streaming ingestion.
  - Optional PII redaction at capture time (emails, file paths, IDs).

- **Memory extraction (`packages/core/memory-extraction`)**
  - LLM‑based extraction of entities, facts, decisions, and custom memory types.
  - Multiple strategies (prompt-based, structured JSON, function-calling style).
  - Pluggable providers (e.g., OpenAI, Anthropic) with profiles for different use cases.
  - Incremental/streaming extraction and conversation chunking for long histories, with token counting and robust error handling.
  - Deduplication, validation, and deterministic IDs so memories can be updated and merged over time.
  - **MAKER reliability layer**: Multi-agent consensus extraction with 3 parallel calls, red-flagging, and voting

- **Storage layer (`packages/core/storage`)**
  - `StorageClient` over SQL backends (SQLite/Supabase/Postgres) and vector backends (Cloudflare Vectorize or local vectors).
  - Workspace-scoped API and multi-tenant isolation built into every query.
  - CRUD for users, workspaces, conversations, memories, and relationships.
  - Semantic vector search (`searchMemories`) plus filtered listing APIs.
  - Result-typed operations (`Result<T, StorageError>`), migrations, and transaction support.

- **Context engine (`packages/core/context-engine`)**
  - Semantic search over memories via the Storage layer + an embedding provider.
  - Embedding cache keyed by `(query, model)` to avoid redundant embeddings.
  - Token-aware context building with configurable templates and budgets.
  - Ranking hooks that combine similarity, recency, confidence, and custom strategies.
  - Optional relationship-aware recall when you want to pull connected memories into context.

- **Local-friendly operation**
  - First-class SQLite support and a local embedding provider (e.g., Transformers.js/Xenova).
  - Example app **Ghost** wires MemoryLayer to:
    - local embeddings,
    - a desktop daemon (Electron) with voice STT/TTS,
    - and a dashboard that shows commands, actions, and the memories used (including streaming output tokens).

## Development Approach

MemoryLayer was developed using Kiro's spec-driven development methodology:

### Spec-Driven Development with Kiro

The `.kiro/specs/` directory contains detailed specifications for all core packages and applications:

**Core Packages (Specs Available)**:
- `core-storage-layer/` → `packages/core/storage/`
- `core-memory-extraction/` → `packages/core/memory-extraction/`
- `core-context-engine/` → `packages/core/context-engine/`
- `core-chat-capture/` → `packages/core/chat-capture/`

**Applications (Specs Available)**:
- `app-handoff/` → `apps/handoff/`
- `ghost-daemon/` → `apps/ghost/daemon/`

**Features (Specs Available)**:
- `conversation-chunking/` → Conversation chunking feature in `memory-extraction`

### Each Spec Contains

1. **requirements.md** - Feature requirements, user stories, and acceptance criteria
2. **design.md** - Architecture, component structure, data models, and API interfaces
3. **tasks.md** - Granular implementation task breakdown

### Development Process

1. **Spec Creation**: Detailed specifications written first, defining APIs, data models, and behavior
2. **AI-Assisted Implementation**: ~80% of initial implementation generated from specs using Kiro
3. **Manual Refinement**: Final implementation includes comprehensive tests, bug fixes, and performance optimizations

This approach enabled:
- Rapid prototyping while maintaining architectural consistency
- Clear documentation of design decisions
- Easier onboarding for new contributors
- Consistent public APIs across packages

---

## License

MIT
