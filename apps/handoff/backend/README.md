# Handoff Backend

Backend for **Handoff**, a MemoryLayer-powered app that turns raw AI chat history into structured, reusable memories you can carry between models.

This package is the Cloudflare Workers API that backs the Handoff frontend. It owns:
- Authentication and workspace management.
- Importing conversation exports (e.g. ChatGPT JSON).
- Running MemoryLayer extraction to create entities, facts, and decisions.
- Serving conversations and memories to the UI.
- Generating a concise “handoff” context string you can paste into another LLM.

---

## What Handoff Is

Handoff is a **personal AI memory tool** for single‑user workspaces:

- You already have months of conversations in tools like ChatGPT.
- Those conversations contain decisions, specs, preferences, and ideas.
- Today, all of that context is **trapped** inside each provider.

Handoff’s job is to:
1. Import those conversations into your own Supabase database.
2. Extract a **memory graph** of entities, facts, and decisions.
3. Let you **reuse** that context:
   - via an in‑app assistant view, or
   - by copying a short, ranked context block into any LLM.

Handoff does **not** replace your existing tools. It sits next to them, giving you:
- A way to see “what my AI history actually says”.
- A safe, ToS‑compliant way to move that context between models.

---

## What Makes Handoff Different

Handoff isn’t just “yet another chat UI” or a generic RAG wrapper:

### 1. Import‑First, ToS‑Friendly
- No browser scraping, no automation against ChatGPT/Claude UIs.
- You use official export flows (e.g. ChatGPT’s `conversations.json`).
- Handoff ingests those exports once, then works entirely on *your* database.

Result: Works with the tools you already use, without violating any provider ToS.

### 2. MemoryLayer, Not Just Logs
- Conversations are stored, but the focus is on **memories**:
  - entities (“Phishing Indicators”, “React migration plan”),
  - decisions (“we chose Postgres for analytics”),
  - facts and metrics.
- Extraction runs in a dedicated pipeline, using:
  - your configured extraction model (e.g. Claude Haiku 4.5),
  - Cloudflare Vectorize for embeddings and search.

You don’t scroll through raw transcripts—you browse a structured view of what matters.

### 2.1 MAKER Reliability Layer

For high-value session summaries, Handoff uses a **MAKER-inspired reliability layer**:

- **Microagents**: Runs 3 parallel LLM calls to extract summaries, decisions, and todos
- **Red-Flagging**: Validates outputs against strict schemas to filter hallucinations
- **Voting**: Uses K-threshold consensus to select the most accurate extraction

MAKER-verified memories are stored with `maker_verified: true` and higher confidence scores (0.95 vs standard 0.6-0.7). This ensures critical project context is robust and consistent.

Configure via environment variables:
- `MAKER_ENABLED` - Enable/disable MAKER (default: true)
- `MAKER_REPLICAS` - Number of parallel agents (default: 3)
- `MAKER_TEMPERATURE` - LLM temperature for consistency (default: 0.4)


### 3. Smart, Concise Handoffs
- The `/api/handoff/export` endpoint builds a **short, opinionated context block**:
  - infers a one‑line `Task:` from the last user message,
  - summarizes the last few turns into a compact “Recent” line,
  - ranks the most relevant memories and outputs them as **Key facts** with source + time + confidence.
- The frontend’s “Copy context for another LLM” button uses this, so you paste:

```text
Context for LLM
- Task: design a phishing detection training module
- Recent: User asked how to categorize phishing indicators | Assistant proposed pillars
- Key facts:
  1) Phishing Indicators: signs like suspicious links and urgent language | type: entity | source: Phishing Indicators | 1d ago | conf: 95%
  2) User Detection Rates: % of users who spot phishing attempts | type: entity | source: Metrics note | 1d ago | conf: 92%
```

Not a wall of transcripts—just the distilled context another model actually needs.

### 4. Single‑User by Design (But Extensible)
- Handoff optimizes for **one user, one workspace**:
  - less complexity,
  - no admin dashboards or deep RBAC,
  - easier to reason about extraction cost.
- The backend still uses MemoryLayer’s multi‑workspace schema, so you can:
  - add a second workspace later (e.g. “work” vs “personal”),
  - or evolve into a team product if needed.

---

## Architecture

- **Runtime**: Cloudflare Workers (via Wrangler)
- **Framework**: Hono (HTTP routing + middleware)
- **Database**: Supabase Postgres (with RLS + JWT auth)
- **Vector/Embeddings**: Cloudflare Vectorize (via `VECTORIZE` binding)
- **MemoryLayer**: structured extraction + storage (entities, decisions, facts)
- **Auth**: JWT-based, backed by Supabase `users` table

The worker mostly does three things:
1) Validates auth (via JWT).  
2) Calls into Supabase via the `exec_sql` helper to run parameterized SQL.  
3) Orchestrates MemoryLayer extraction and formats responses for the frontend (conversations, memories, handoff text).


## Development

```bash
# Install dependencies (from root)
npm install

# Start dev server
cd apps/handoff-backend
npm run dev

# Run tests
npm test

# Deploy to Cloudflare Workers
npm run deploy
```

## Environment Variables

Create a `.dev.vars` file for local development:

```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
JWT_SECRET=your_jwt_secret
```

For production, set secrets using:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY  
wrangler secret put JWT_SECRET
```

The `VECTORIZE_*` and `OPENAI_*` variables are used by the extraction pipeline:
- **VECTORIZE**: Cloudflare Vectorize index for memory embeddings and search.
- **OPENAI\_*** (or OpenRouter) : chat/extraction models (e.g. Claude Haiku 4.5 + text-embedding-3-small).

## API Overview

All routes are mounted under `/api` when running via Wrangler.

### Authentication
- `POST /auth/signup` – Create new user account (email/password)
- `POST /auth/login` – Login, returns JWT
- `GET /auth/me` – Return current user (from `Authorization: Bearer <token>`)

### Workspaces
- `GET /workspaces` – List workspaces the user owns or is a member of
- `POST /workspaces` – Create workspace (`personal` or `team`)
- `POST /workspaces/:id/members` – Invite/add member by email
- `GET /workspaces/:id/members` – List members
- `DELETE /workspaces/:id` – Delete workspace (owner only)

### Conversations
- `GET /conversations` – List conversations in a workspace (with paging/search)
- `GET /conversations/:id` – Conversation detail (messages + metadata)

### Memories
- `GET /memories` – List/search memories in a workspace (type/date/search filters)
- `GET /memories/:id` – Single memory detail (with attribution fields)

### Import/Export
- `POST /import` – Import conversation JSON into a workspace (e.g. ChatGPT export)
  - Creates `conversations`, `messages`, runs extraction to produce `memories`.
- `GET /handoff/export` – Build a concise, copy‑ready context block for another LLM
  - Query params: `conversation_id`, `workspace_id`
  - Response: `{ handoff: string, conversation_id, workspace_id }`
  - The `handoff` string is intentionally short and “smart”:
    - Optional `Task:` line derived from the last user message.
    - Short “Recent:” summary (last few turns, trimmed).
    - Ranked “Key facts:” pulled from top memories (entities/decisions/facts) with source + relative time + confidence.
  - This is what the frontend’s “Copy context for another LLM” button uses.

See [IMPORT_API.md](./IMPORT_API.md) and [EXPORT_API.md](./EXPORT_API.md) for details.

## Database Schema

Tables:
- `users` - User accounts
- `workspaces` - User workspaces (personal/team)
- `workspace_members` - Team membership
- `conversations` - Chat conversations  
- `messages` - Conversation messages
- `memories` - Extracted memories
- `relationships` - Memory relationships

Migrations: [SETUP_DATABASE.sql](./SETUP_DATABASE.sql)

## License

MIT
