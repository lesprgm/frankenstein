# MemoryLayer

**The universal memory layer for AI applications.**

---

## The Problem

Once you go beyond “toy chatbot”, almost every AI product needs some version of a **memory stack**:

- Ingest conversations, tickets, logs, or notes from different sources.
- Run LLMs to extract entities, facts, decisions, and relationships.
- Store that graph with embeddings so you can search it semantically.
- Assemble a compact, token‑bounded context window for each new LLM call.

This shows up in lots of places:
- personal agents and copilots (“remember what I asked last week”),
- team knowledge tools and workspaces,
- incident/ops copilots,
- support and customer success tools,
- research or learning notebooks.

Today, most teams rebuild this stack themselves:
- 4–6+ weeks of engineering,
- tightly coupled to a specific provider or framework,
- and bespoke designs that are hard to reuse in the next app.

Existing solutions tend to be:
- **Provider‑locked** – tied to a single LLM or vendor’s APIs.
- **Cloud‑only** – difficult to run locally or on your own infra.
- **Monolithic** – you have to adopt the whole framework instead of just storage or just context.

If you want:
- a slim storage + search layer for memories,
- plus a context engine,
- plus a flexible extraction pipeline,

you usually end up writing it yourself.

---

## The Solution

MemoryLayer is a small, production‑ready memory stack you can drop into any service and compose the way you want:

- **Capture** – normalize conversations/logs from different providers.
- **Extract** – use LLMs to turn raw text into structured memories (entities, facts, decisions).
- **Store & search** – keep everything in SQL + vectors with workspace‑scoped APIs.
- **Assemble context** – build token‑aware prompts from the right memories.

You can adopt just one piece (e.g. `storage` + `context-engine`) or the whole pipeline.

We validated this by building two very different applications on the same skeleton:

- **Ghost** – a local, voice‑driven desktop agent that uses MemoryLayer to remember commands, files, and actions.
- **Handoff** – a workspace UI that imports ChatGPT/Claude history, extracts a memory graph, and lets you create copy‑and‑pasteable briefs for any LLM.

Both were developed on top of the same `packages/core` modules, using Kiro’s spec‑driven workflow in `.kiro/specs/` to keep the design consistent.

**Key properties:**

- ✅ **Deploy anywhere** – works with SQLite locally or Postgres/Supabase in the cloud.  
- ✅ **Modular** – capture, extraction, storage, and context are separate packages you can mix and match.  
- ✅ **Model‑agnostic** – plug in OpenAI, Anthropic, Gemini, or your own LLM/embedding provider.  
- ✅ **Spec‑driven** – core APIs and data models were designed up front via Kiro specs, then implemented and refined with tests.

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

- **Spec-driven development with Kiro**
  - `.kiro/specs/` contains the design, requirements, and task breakdowns for storage, context-engine, memory-extraction, chat-capture, Ghost, and Handoff.
  - The public APIs, data models, and folder structure in `packages/core` mirror those specs.
  - Roughly ~80% of MemoryLayer’s implementation was “vibe coded” against these specs with Kiro, then finalized with tests and manual refinement.

---

## How I Used Kiro (Spec‑Driven Development)

This repo was built alongside Kiro using its spec‑driven development workflow. Instead of only vibe‑coding (“write some code for X”), I wrote requirements and designs under `.kiro/specs/` and then asked Kiro to implement against those documents.

### Core skeleton specs

Under `.kiro/specs/core-*` I defined the MemoryLayer skeleton:

- `.kiro/specs/core-storage-layer/`  
  `requirements.md` describes the storage layer as a unified abstraction over Supabase Postgres + Cloudflare Vectorize, with workspace‑scoped models for users, workspaces, conversations, memories, and relationships.  
  `design.md` and `tasks.md` break this into concrete APIs and implementation steps (`StorageClient`, typed CRUD, migrations, error types). The code in `packages/core/storage` maps directly onto those documents: data models, workspace_id scoping, and vector search APIs were all generated and refined with Kiro against that spec.

- `.kiro/specs/core-memory-extraction/`  
  Defines how entities, facts, and decisions should be extracted from conversations, with separate profiles and confidence thresholds. The implementation in `packages/core/memory-extraction` (memory types, extraction strategies, result shapes) came from this spec and then I tightened it with tests.

- `.kiro/specs/core-context-engine/`  
  Specifies the context engine: semantic search over memories, token budgets, ranking rules (similarity, recency, confidence). The `packages/core/context-engine` code (context builder, ranking, template support) is a direct reflection of that spec rather than a pile of ad‑hoc helpers.

- `.kiro/specs/core-chat-capture/` and `.kiro/specs/conversation-chunking/`  
  Cover how raw provider exports should be normalized into a common schema and chunked for extraction. The ingestion/chunking utilities in the core packages follow these requirements, which made it straightforward to support static exports and keep room for live ingestion later.

### App‑level specs (Ghost and Handoff)

I also wrote Kiro specs for the two applications that sit on top of MemoryLayer:

- `.kiro/specs/ghost-daemon/`  
  Describes Ghost as a local desktop agent (hotkey, STT, TTS, local embeddings, MemoryLayer integration). This spec drove the structure of `apps/ghost` (daemon, backend, dashboard) and how it wires into the core packages.

- `.kiro/specs/app-handoff/`  
  Defines Handoff’s behaviour as an AI memory app: automatic personal workspace creation, imports, extraction, memory timeline, context‑aware chat, conversations view, workspace switcher, export/delete flows, and team workspaces.  
  There’s a near 1‑to‑1 mapping between the requirements in `app-handoff/requirements.md` and what exists in `apps/handoff-backend` + `apps/handoff-frontend`:
  - Requirement 1 → signup + automatic personal workspace.
  - Requirements 2–3 → import endpoint + extraction pipeline.
  - Requirements 4–7 → memories timeline, chat with injected context, conversations list/detail.
  - Requirements 8–12 → settings page, workspace delete/export, multi‑workspace routing and isolation.
  - Requirement 13–14 → team attribution and activity feed, plus performance expectations.

### Why spec‑driven vs pure vibe coding?

I did use vibe coding heavily for exploration (e.g. “sketch a StorageClient” or “draft the Ghost daemon loop”), but the spec‑driven approach became the backbone for anything I wanted to keep:

- Writing the specs first forced me to clarify *what* the storage layer, extraction pipeline, and apps needed to do before I asked for code.  
- When I changed my mind about how workspaces or team membership should work, I updated the spec in `.kiro/specs/app-handoff` and then asked Kiro to adjust the implementation in a controlled way, instead of gradually drifting.  
- Because Ghost and Handoff specs were both written against the same core models and APIs, Kiro could reuse the MemoryLayer skeleton cleanly across two very different applications.

In practice, about ~80% of MemoryLayer and a large portion of Ghost/Handoff were implemented by Kiro from these specs, with the remaining 20% being manual wiring, UI polish, and tests. The `.kiro/specs` directory is effectively the design contract that the code in `packages/core` and `apps/*` implements.

---

---

## Architecture

At the center is a simple pipeline that turns raw interaction logs into a searchable memory graph, then surfaces the right pieces back to your LLM.

```mermaid
graph TD
    subgraph "MemoryLayer Core"
        direction TB
        CC[chat-capture\n(raw logs)] -->|Normalize & Redact| ME[memory-extraction\n(LLM)]
        ME -->|Memories (entities, facts, relationships)| S[storage\n(SQL + Vectors)]
        S -->|Semantic & filtered search| CE[context-engine\n(context window)]
    end

    classDef core fill:#e0e7ff,stroke:#4338ca,stroke-width:2px;
    class CC,ME,S,CE core;
```

### Core Packages (`packages/core`)

- `chat-capture`  
  - Parses exports and live streams from providers (e.g., OpenAI, Anthropic, custom logs).  
  - Normalizes into a common conversation schema (messages, sender, timestamps, metadata).  
  - Optional PII redaction (emails, paths, IDs) at ingestion time.

- `memory-extraction`  
  - Wraps LLMs (OpenAI, Gemini, etc.) to extract:
    - **entities** – people, files, organizations, projects.  
    - **facts/decisions** – what was decided, when, by whom.  
    - **relationships** – entity ↔ entity, entity ↔ fact, etc.  
  - Uses strongly-typed, JSON-structured outputs so “memories” are small, durable objects instead of blobs of text.

- `storage`  
  - A `StorageClient` facade over:
    - a SQL backend (SQLite/Postgres via provided adapters), and  
    - an embedding/vector backend (local, Vectorize, or custom).  
  - Handles migrations, indexes, and a consistent memory schema.  
  - Exposes convenience methods: create/list/search memories, conversations, relationships.

- `context-engine`  
  - Given a query, builds a **context window** with:
    - semantic search over memories (by embedding),  
    - metadata filters (time range, workspace, entity types),  
    - templates that format results into prompt-ready text.  
  - Enforces a token budget and returns a ranked, trimmed set of memories for your LLM.

---

## Conceptual Flow

1. **Capture** (`chat-capture`)  
   - Input: raw chat logs or streaming events.  
   - Output: normalized conversations with metadata and optional redaction.

2. **Extract** (`memory-extraction`)  
   - Input: normalized conversations.  
   - Output: structured `Memory` objects (entities, facts, decisions, relationships) plus optional embeddings.

3. **Store** (`storage`)  
   - Input: `Memory` objects and embeddings.  
   - Output: durable records in SQL and a vector store, indexed for fast lookup.

4. **Recall** (`context-engine`)  
   - Input: a new user query or tool call.  
   - Output: a curated context window (top-k memories + snippets) and metadata you can feed into an LLM.

The result: instead of rebuilding context from scratch for every LLM call, you operate over a shared, evolving memory layer.

---

## Repository Layout (MemoryLayer Core)

Relevant to MemoryLayer:

```bash
packages/
  core/
    chat-capture/       # Conversation ingestion + normalization
    context-engine/     # Semantic + filtered recall, prompt templates
    memory-extraction/  # LLM-backed extraction of entities/facts/decisions
    storage/            # StorageClient + adapters (SQLite/Postgres/Vector)
  shared/               # Shared types and utilities for core modules
```

Consumer applications (e.g., Ghost, Handoff) live under `apps/` and use these core packages, but are not required to use MemoryLayer itself.

---

## Using MemoryLayer in Your Own Service

At a high level you:

1. **Wire a storage client**
   - Choose SQLite (local) or Postgres (remote).  
   - Optionally configure a vector backend (local or managed).

2. **Set up extraction**
   - Provide an LLM provider (OpenAI, Gemini, etc.).  
   - Register the memory types (entities/facts/decisions) that matter to your app.

3. **Build context on each request**
   - For each new user query or command:
     - run `context-engine` to retrieve relevant memories,  
     - build a prompt (template + context + query),  
     - call your LLM and optionally write new memories from the response.

The core packages are designed so you can drop individual pieces into an existing codebase (e.g., only `storage` + `context-engine`) without adopting the entire stack at once.

---

## Minimal Setup (Example)

Below is a sketch of how you might wire MemoryLayer into a Node/TypeScript service:

```ts
import { StorageClient } from '@memorylayer/storage';
import { MemoryExtractor } from '@memorylayer/memory-extraction';
import { ContextEngine } from '@memorylayer/context-engine';

// 1. Storage client (SQLite for local dev)
const storageClient = new StorageClient({
  sqlite: { filename: './memorylayer.db' },
  vectorize: { mode: 'local' }, // or external vector backend
});

// 2. Memory extraction (LLM-backed)
const extractor = new MemoryExtractor({
  // you provide the LLM provider; this is intentionally pluggable
  provider: /* e.g. new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }) */,
});

// 3. Context engine (semantic + filtered recall)
const contextEngine = new ContextEngine({
  storageClient,
  embeddingProvider: /* e.g. OpenAIEmbeddingProvider or local embeddings */,
  defaultTemplate: 'chat',
  defaultTokenBudget: 2000,
});

// 4. On each request: capture → extract → store → recall
async function handleUserMessage(workspaceId: string, text: string) {
  // (a) Extract memories from the message or conversation
  const extracted = await extractor.extractFromText(text, { workspace_id: workspaceId });
  if (extracted.ok && extracted.value.memories.length > 0) {
    await storageClient.createMemories(extracted.value.memories);
  }

  // (b) Build context for an LLM call
  const ctx = await contextEngine.buildContext(text, workspaceId, {
    limit: 8,
    tokenBudget: 1500,
  });

  // (c) Use ctx.value.context + ctx.value.memories in your LLM prompt
}
```

The actual APIs in `packages/core` give you a bit more control (custom memory types, templates, rankers), but the pattern is as above.

---

## Design Principles

- **Lean first, batteries optional**  
  Core packages avoid heavy framework coupling and keep entrypoints small. You can:
  - use only `storage` as a typed DB client,  
  - layer `context-engine` on top for semantic recall, or  
  - add `memory-extraction` when you’re ready to spend LLM tokens.

- **Local-friendly by default**  
  - SQLite is supported directly for single-node and local setups.  
  - Vector storage can run in “local” mode or delegate to a hosted backend.  
  - This makes it easy to prototype on a laptop and later swap in Postgres/managed vectors.

- **Strongly typed memories**  
  - Memories are JSON objects with explicit types (entity/fact/decision/relationship), not free-form strings.  
  - This keeps prompts and UI layers simpler and allows downstream tooling (dashboards, audits) to reason over the memory graph.

- **Composable, not monolithic**  
  - Capture, extraction, storage, and context are separate packages with narrow interfaces.  
  - You can replace or wrap any one of them (e.g., your own extractor strategy) without forking the rest.

---

## Extensibility Points

Some common places you are expected to customize:

- **Custom memory types**  
  - Register new types (e.g., `task`, `incident`, `experiment`) with their own extraction prompts and schemas.  
  - Use these in dashboards, alerts, or routing logic.

- **Custom rankers**  
  - Plug in your own ranking function in `context-engine` to favor:
    - recency,  
    - confidence,  
    - certain memory types (e.g., decisions over raw facts).

- **Context templates**  
  - Define different templates for different tools or surfaces:
    - “chat” (human-readable context snippets),  
    - “json” (machine-oriented context payloads),  
    - “audit” (include metadata and provenance).

- **Backends**  
  - Swap adapters in `storage` for:
    - SQLite ↔ Postgres,  
    - local vectors ↔ managed vector store,  
    without changing calling code.

---

## How MemoryLayer Was Built (with Kiro)

This repo was developed in a **spec‑driven** way using Kiro:

- The `.kiro/specs/` tree holds the design docs, requirements, and task breakdowns for each core module:  
  - `core-storage-layer/` – storage client + migrations + result‑typed API.  
  - `core-context-engine/` – semantic recall, ranking, templates, token budgets.  
  - `core-memory-extraction/` – LLM strategies for entities/facts/decisions.  
  - plus specs for chat capture, conversation chunking, the Ghost daemon, and Handoff.

- The code in `packages/core` was written to **mirror those specs**: the public APIs, data models, and directory layouts come directly from the Kiro design docs, so you can read a spec and jump straight into the corresponding implementation.

- Kiro was also used as a “vibe coding” partner for most of MemoryLayer’s implementation:  
  roughly ~80% of the core modules were scaffolded, iterated, and refactored with Kiro, then hardened with tests and hand edits. The goal was to keep the code:
  - small and readable,  
  - faithful to the original specs, and  
  - easy to reuse in other projects (like Ghost and Handoff).

If you want to understand *why* things look the way they do, start in `.kiro/specs/` and then follow the matching paths under `packages/core/`.

## Documentation

- Specs and design notes: `.kiro/specs/`
- Deployment and ops patterns: `DEPLOYMENT.md`, `QUICKSTART_DEPLOYMENT.md`
- Troubleshooting and monitoring patterns: `TROUBLESHOOTING.md`, `MONITORING.md`

---

## License

MIT
