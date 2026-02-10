# Handoff Architecture

This document provides a comprehensive technical overview of the Handoff application architecture, covering all major components, their interactions, data flows, and design decisions.

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
   - [Backend](#backend)
   - [Frontend](#frontend)
3. [Core Subsystems](#core-subsystems)
   - [Authentication System](#authentication-system)
   - [Conversation Import Pipeline](#conversation-import-pipeline)
   - [Memory Extraction Engine](#memory-extraction-engine)
   - [Semantic Search](#semantic-search)
   - [Handoff Export](#handoff-export)
4. [Data Flow](#data-flow)
5. [Database Architecture](#database-architecture)
6. [Security Model](#security-model)
7. [External Integrations](#external-integrations)
8. [Deployment Architecture](#deployment-architecture)
9. [Configuration Management](#configuration-management)

---

## System Overview

Handoff is a MemoryLayer-powered application that transforms raw AI chat history into structured, reusable memories. The system follows a client-server architecture optimized for serverless deployment:

```
+-------------------+     +-------------------+     +-------------------+
|                   |     |                   |     |                   |
|     Frontend      |<--->|     Backend       |<--->|    Supabase      |
|   (React/Vite)    |     | (Cloudflare Workers)|   |   (Postgres)     |
|                   |     |                   |     |                   |
+-------------------+     +-------------------+     +-------------------+
                                  |
                                  v
                    +-------------------+     +-------------------+
                    |   Cloudflare      |     |    LLM Provider   |
                    |   Vectorize       |     | (OpenAI/OpenRouter)|
                    +-------------------+     +-------------------+
```

### Design Philosophy

1. **ToS-Compliant Import**: Uses official export flows only, no browser scraping or automation.

2. **Serverless-First**: Backend runs on Cloudflare Workers for global edge deployment with minimal cold starts.

3. **Single-User Focused**: Optimized for individual use while supporting workspace extensibility.

4. **Structured Memory Over Logs**: Focus on extracting meaningful entities, facts, and decisions rather than storing raw transcripts.

5. **Privacy-Preserving**: All data stays in the user's own Supabase database instance.

---

## Component Architecture

### Backend

**Location**: `apps/handoff/backend/`

**Runtime**: Cloudflare Workers with Hono framework

**Purpose**: Provides API endpoints for authentication, data import, memory management, and handoff export.

#### Directory Structure

```
backend/src/
  index.ts              # Hono app setup, all route definitions
  
  routes/
    auth.ts             # Authentication route handlers (refactored)
    health.ts           # Health check endpoints
    
  services/
    auth-service.ts         # User authentication logic
    workspace-service.ts    # Workspace CRUD operations
    conversation-service.ts # Conversation management
    memory-service.ts       # Memory operations
    import-service.ts       # ChatGPT import processing
    export-service.ts       # Handoff context generation
    extraction-service.ts   # Memory extraction orchestration
    vector-service.ts       # Vectorize integration
    supabase-service.ts     # Database operations
    maker-service.ts        # MAKER reliability layer
    
  middleware/
    auth.ts             # JWT validation middleware
    cors.ts             # CORS configuration
    
  lib/
    jwt.ts              # JWT token utilities
    
  types/
    index.ts            # TypeScript type definitions
```

#### Service Layer Architecture

The backend follows a service-oriented architecture where each service encapsulates a specific domain:

```
                    +-----------------+
                    |   Hono Router   |
                    |   (index.ts)    |
                    +-----------------+
                            |
            +---------------+---------------+
            |               |               |
            v               v               v
    +-----------+   +-----------+   +-----------+
    |   Auth    |   |  Memory   |   |  Import   |
    | Service   |   | Service   |   | Service   |
    +-----------+   +-----------+   +-----------+
            |               |               |
            +---------------+---------------+
                            |
                            v
                    +-----------------+
                    |    Supabase     |
                    |    Service      |
                    +-----------------+
                            |
                            v
                    +-----------------+
                    |    Postgres     |
                    +-----------------+
```

#### Key Services

**AuthService**

Handles user authentication and session management:

- User registration with email/password
- Login with JWT token generation
- Token validation and refresh
- Password hashing with bcrypt

**ImportService**

Processes ChatGPT export files:

- Parses `conversations.json` format
- Normalizes message structure
- Batches conversations for extraction
- Tracks import progress and status

**ExtractionService**

Orchestrates memory extraction from conversations:

- Coordinates with MemoryLayer packages
- Manages extraction queue
- Handles MAKER reliability layer
- Updates extraction status

**VectorService**

Manages Cloudflare Vectorize integration:

- Generates embeddings via OpenAI
- Stores vectors with metadata
- Performs similarity search
- Handles index management

**ExportService**

Generates concise handoff context blocks:

- Analyzes recent conversation context
- Ranks relevant memories
- Formats output for LLM consumption
- Calculates confidence scores

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/signup` | POST | Create new user account |
| `/api/auth/login` | POST | Authenticate and get JWT |
| `/api/auth/me` | GET | Get current user info |
| `/api/workspaces` | GET | List user workspaces |
| `/api/workspaces` | POST | Create new workspace |
| `/api/workspaces/:id` | DELETE | Delete workspace |
| `/api/workspaces/:id/members` | GET | List workspace members |
| `/api/workspaces/:id/members` | POST | Add member to workspace |
| `/api/conversations` | GET | List conversations |
| `/api/conversations/:id` | GET | Get conversation details |
| `/api/memories` | GET | List/search memories |
| `/api/memories/:id` | GET | Get memory details |
| `/api/import` | POST | Import conversation JSON |
| `/api/handoff/export` | GET | Generate handoff context |

---

### Frontend

**Location**: `apps/handoff/frontend/`

**Runtime**: React 18 with Vite

**Purpose**: Provides the user interface for authentication, conversation browsing, memory exploration, and handoff generation.

#### Directory Structure

```
frontend/src/
  App.tsx               # Root component with routing
  main.tsx              # Application entry point
  index.css             # Global styles (Tailwind)
  
  pages/
    Login.tsx           # Login page
    Signup.tsx          # Registration page
    Dashboard.tsx       # Main dashboard view
    Conversations.tsx   # Conversation list
    ConversationDetail.tsx # Single conversation view
    Memories.tsx        # Memory browser
    MemoryDetail.tsx    # Single memory view
    Import.tsx          # Import wizard
    Export.tsx          # Handoff export
    Settings.tsx        # User settings
    
  components/
    layout/
      Sidebar.tsx       # Navigation sidebar
      Header.tsx        # Page header
      Layout.tsx        # Main layout wrapper
    common/
      Button.tsx        # Reusable button
      Input.tsx         # Form input
      Card.tsx          # Card container
      Modal.tsx         # Modal dialog
    conversation/
      ConversationList.tsx
      MessageBubble.tsx
    memory/
      MemoryCard.tsx
      MemoryGraph.tsx
      ConfidenceBadge.tsx
      
  contexts/
    AuthContext.tsx     # Authentication state
    WorkspaceContext.tsx # Current workspace
    
  hooks/
    useAuth.ts          # Authentication hook
    useConversations.ts # Conversation data
    useMemories.ts      # Memory data
    useImport.ts        # Import status
    useExport.ts        # Export generation
    
  lib/
    api.ts              # Backend API client
    auth.ts             # Auth utilities
    storage.ts          # Local storage helpers
    types.ts            # TypeScript definitions
```

#### State Management

The frontend uses a combination of React Context and TanStack Query:

```
+-------------------+     +-------------------+
|   AuthContext     |     | WorkspaceContext  |
|   (user, token)   |     | (current workspace)|
+-------------------+     +-------------------+
         |                         |
         +-----------+-------------+
                     |
                     v
+-------------------------------------------+
|            TanStack Query                  |
|  (data fetching, caching, synchronization) |
+-------------------------------------------+
         |
         v
+-------------------+
|    API Client     |
+-------------------+
```

**AuthContext**: Manages user authentication state, JWT token storage, and login/logout flows.

**WorkspaceContext**: Tracks the currently selected workspace and provides workspace switching functionality.

**TanStack Query**: Handles all server state including conversations, memories, and import status with automatic caching and refetching.

#### Page Components

| Page | Purpose |
|------|---------|
| Dashboard | Overview with stats and recent activity |
| Conversations | Paginated list with search and filtering |
| ConversationDetail | Full conversation with messages |
| Memories | Memory browser with type/date filters |
| MemoryDetail | Single memory with source attribution |
| Import | Multi-step import wizard |
| Export | Handoff context generation and copy |
| Settings | User preferences and API keys |

---

## Core Subsystems

### Authentication System

The authentication system uses JWT tokens with Supabase as the user store:

```
User Credentials
       |
       v
+-----------------+
|   AuthService   |  (Validate password)
+-----------------+
       |
       v
+-----------------+
|   JWT Creation  |  (Sign with secret)
+-----------------+
       |
       v
+-----------------+
|   Response      |  (token, user info)
+-----------------+
```

#### Token Structure

```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "workspace_id": "default_workspace_id",
  "iat": 1699900000,
  "exp": 1699986400
}
```

#### Password Security

- Hashing: bcrypt with cost factor 10
- Minimum length: 8 characters
- No plaintext storage

#### Session Management

- Token expiry: 24 hours
- Refresh: Re-authenticate required
- Storage: localStorage in frontend

---

### Conversation Import Pipeline

The import pipeline processes ChatGPT export files:

```
Export File Upload
        |
        v
+------------------+
|   File Parser    |  (Parse JSON structure)
+------------------+
        |
        v
+------------------+
|   Normalizer     |  (Standardize format)
+------------------+
        |
        v
+------------------+
|   Batch Creator  |  (Group for processing)
+------------------+
        |
        v
+------------------+
|   Database       |  (Store conversations)
|   Writer         |
+------------------+
        |
        v
+------------------+
|   Extraction     |  (Queue for memory extraction)
|   Queue          |
+------------------+
```

#### ChatGPT Export Format

The pipeline expects the official ChatGPT export format:

```json
{
  "conversations": [
    {
      "id": "conversation_id",
      "title": "Conversation Title",
      "create_time": 1699900000,
      "update_time": 1699986400,
      "mapping": {
        "message_id": {
          "id": "message_id",
          "message": {
            "author": { "role": "user" | "assistant" },
            "content": { "parts": ["message text"] }
          },
          "parent": "parent_message_id"
        }
      }
    }
  ]
}
```

#### Normalization Process

1. Flatten the tree structure into linear messages
2. Extract text content from nested parts
3. Map roles to standard format
4. Preserve timestamps and metadata
5. Generate stable IDs for deduplication

#### Import Status Tracking

| Status | Description |
|--------|-------------|
| `pending` | File uploaded, awaiting processing |
| `parsing` | Parsing JSON structure |
| `importing` | Writing to database |
| `extracting` | Memory extraction in progress |
| `completed` | All processing complete |
| `failed` | Error occurred |

---

### Memory Extraction Engine

The extraction engine converts conversations into structured memories:

```
Conversation
     |
     v
+-----------------+
|   Chunking      |  (Split long conversations)
+-----------------+
     |
     v
+-----------------+
|   LLM Prompt    |  (Build extraction prompt)
+-----------------+
     |
     v
+-----------------+
|   LLM Call      |  (OpenAI/OpenRouter)
+-----------------+
     |
     v
+-----------------+
|   Validation    |  (Schema validation)
+-----------------+
     |
     v
+-----------------+
|   Storage       |  (Save to database)
+-----------------+
     |
     v
+-----------------+
|   Vectorization |  (Generate embeddings)
+-----------------+
```

#### Extraction Schema

The LLM extracts structured data matching this schema:

```typescript
interface ExtractionResult {
  entities: Array<{
    name: string;
    type: string;
    description: string;
    confidence: number;
  }>;
  facts: Array<{
    statement: string;
    source: string;
    confidence: number;
  }>;
  decisions: Array<{
    decision: string;
    context: string;
    confidence: number;
  }>;
  todos: Array<{
    task: string;
    priority: string;
    confidence: number;
  }>;
}
```

#### MAKER Reliability Layer

For high-stakes extractions, the MAKER layer provides consensus:

```
Conversation Text
        |
        +-----------+-----------+
        |           |           |
        v           v           v
  +----------+ +----------+ +----------+
  | Agent 1  | | Agent 2  | | Agent 3  |
  +----------+ +----------+ +----------+
        |           |           |
        +-----------+-----------+
                    |
                    v
            +---------------+
            |   Validator   |  (Schema check)
            +---------------+
                    |
                    v
            +---------------+
            |    Voter      |  (K-threshold)
            +---------------+
                    |
                    v
            +---------------+
            |   Consensus   |
            |    Result     |
            +---------------+
```

**Configuration**:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAKER_ENABLED` | true | Enable MAKER layer |
| `MAKER_REPLICAS` | 3 | Number of parallel agents |
| `MAKER_TEMPERATURE` | 0.4 | LLM temperature |
| `MAKER_MODEL` | gemini-2.0-flash-lite | Model for extraction |

**Confidence Scoring**:

- Standard extraction: 0.6-0.7 confidence
- MAKER-verified extraction: 0.95 confidence
- Memories marked with `maker_verified: true`

---

### Semantic Search

Semantic search uses Cloudflare Vectorize for similarity matching:

```
Search Query
     |
     v
+-----------------+
|   Embedding     |  (OpenAI text-embedding-ada-002)
+-----------------+
     |
     v
+-----------------+
|   Vectorize     |  (Similarity search)
|   Query         |
+-----------------+
     |
     v
+-----------------+
|   Result        |  (Memory IDs + scores)
|   Ranking       |
+-----------------+
     |
     v
+-----------------+
|   Database      |  (Fetch full memories)
|   Hydration     |
+-----------------+
```

#### Vector Index Configuration

- **Dimensions**: 1536 (OpenAI ada-002)
- **Metric**: Cosine similarity
- **Index Name**: handoff-memories

#### Search Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `topK` | 10 | Maximum results |
| `threshold` | 0.7 | Minimum similarity |
| `type` | all | Memory type filter |
| `dateRange` | all | Date filter |

---

### Handoff Export

The export system generates concise context blocks for LLM handoff:

```
Export Request
      |
      v
+------------------+
|   Task Inference |  (Analyze recent query)
+------------------+
      |
      v
+------------------+
|   Context        |  (Summarize recent turns)
|   Summarization  |
+------------------+
      |
      v
+------------------+
|   Memory         |  (Rank by relevance)
|   Ranking        |
+------------------+
      |
      v
+------------------+
|   Formatter      |  (Generate text block)
+------------------+
```

#### Output Format

```text
Context for LLM
- Task: [inferred task from last user message]
- Recent: [summary of recent conversation turns]
- Key facts:
  1) [fact 1] | type: [type] | source: [source] | [time ago] | conf: [%]
  2) [fact 2] | type: [type] | source: [source] | [time ago] | conf: [%]
  ...
```

#### Ranking Algorithm

Memories are ranked by a weighted score:

```
score = (relevance * 0.4) + (recency * 0.3) + (confidence * 0.3)
```

Where:

- **relevance**: Semantic similarity to current query (0.0-1.0)
- **recency**: Time decay function (1.0 for today, decreasing)
- **confidence**: Extraction confidence score (0.0-1.0)

---

## Data Flow

### Import Flow

```
1. User uploads conversations.json from ChatGPT export
                |
2. Frontend sends file to POST /api/import
                |
3. ImportService parses JSON structure
                |
4. ConversationService stores raw conversations
                |
5. ExtractionService queues for memory extraction
                |
6. For each conversation:
   a. LLM extracts entities, facts, decisions
   b. Validator checks schema compliance
   c. MemoryService stores memories
   d. VectorService generates embeddings
                |
7. Frontend polls for completion status
                |
8. User sees imported conversations and memories
```

### Query Flow

```
1. User enters search query "What did we decide about auth?"
                |
2. Frontend sends query to GET /api/memories?search=...
                |
3. VectorService generates query embedding
                |
4. Vectorize returns similar memory IDs
                |
5. MemoryService fetches full memory records
                |
6. Results returned with confidence and source
                |
7. Frontend displays ranked memory cards
```

### Handoff Flow

```
1. User clicks "Generate Handoff" button
                |
2. Frontend sends GET /api/handoff/export
                |
3. ExportService analyzes recent conversation
                |
4. Semantic search retrieves relevant memories
                |
5. Ranking algorithm orders by importance
                |
6. Formatter generates context block
                |
7. User copies output to another LLM
```

---

## Database Architecture

### Schema Overview

```
+------------------+          +------------------+
|      users       |          |    workspaces    |
+------------------+          +------------------+
| id (PK)          |<-------->| id (PK)          |
| email            |    |     | name             |
| password_hash    |    |     | type             |
| created_at       |    |     | owner_id (FK)    |
+------------------+    |     +------------------+
                        |              |
                        v              v
              +------------------+------------------+
              |                                     |
              v                                     v
    +------------------+              +------------------+
    |workspace_members |              |  conversations   |
    +------------------+              +------------------+
    | workspace_id (FK)|              | id (PK)          |
    | user_id (FK)     |              | workspace_id (FK)|
    | role             |              | title            |
    +------------------+              | source           |
                                      | created_at       |
                                      +------------------+
                                               |
                                               v
                                      +------------------+
                                      |    messages      |
                                      +------------------+
                                      | id (PK)          |
                                      | conversation_id  |
                                      | role             |
                                      | content          |
                                      | created_at       |
                                      +------------------+
                                               
              +------------------+
              |    memories      |
              +------------------+
              | id (PK)          |
              | workspace_id (FK)|
              | type             |
              | content          |
              | summary          |
              | confidence       |
              | maker_verified   |
              | source_id (FK)   |
              | created_at       |
              +------------------+
                       |
                       v
              +------------------+
              |  relationships   |
              +------------------+
              | source_id (FK)   |
              | target_id (FK)   |
              | type             |
              | strength         |
              +------------------+
```

### Core Tables

**users**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | TEXT | Unique email |
| password_hash | TEXT | bcrypt hash |
| created_at | TIMESTAMP | Registration time |

**workspaces**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Workspace name |
| type | TEXT | 'personal' or 'team' |
| owner_id | UUID | Owner user ID |
| created_at | TIMESTAMP | Creation time |

**workspace_members**

| Column | Type | Description |
|--------|------|-------------|
| workspace_id | UUID | Workspace FK |
| user_id | UUID | User FK |
| role | TEXT | 'owner', 'admin', 'member' |
| joined_at | TIMESTAMP | Join time |

**conversations**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | Workspace FK |
| external_id | TEXT | Original provider ID |
| title | TEXT | Conversation title |
| source | TEXT | Import source (e.g., 'chatgpt') |
| message_count | INTEGER | Number of messages |
| created_at | TIMESTAMP | Original creation time |
| imported_at | TIMESTAMP | Import time |

**messages**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| conversation_id | UUID | Conversation FK |
| role | TEXT | 'user', 'assistant', 'system' |
| content | TEXT | Message text |
| position | INTEGER | Order in conversation |
| created_at | TIMESTAMP | Message time |

**memories**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | Workspace FK |
| type | TEXT | 'entity', 'fact', 'decision' |
| content | TEXT | Full content |
| summary | TEXT | Brief summary |
| confidence | REAL | Confidence score (0-1) |
| maker_verified | BOOLEAN | MAKER verification flag |
| source_conversation_id | UUID | Source conversation FK |
| source_message_id | UUID | Source message FK |
| metadata | JSONB | Additional metadata |
| created_at | TIMESTAMP | Extraction time |

**relationships**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source_id | UUID | Source memory FK |
| target_id | UUID | Target memory FK |
| type | TEXT | Relationship type |
| strength | REAL | Relationship strength (0-1) |
| workspace_id | UUID | Workspace FK |

### Row-Level Security

Supabase RLS policies enforce workspace-scoped access:

```sql
-- Example policy for memories table
CREATE POLICY "Users can access memories in their workspaces"
ON memories
FOR ALL
USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members 
    WHERE user_id = auth.uid()
  )
);
```

### Indexes

| Table | Index | Columns |
|-------|-------|---------|
| memories | memories_workspace_type | workspace_id, type |
| memories | memories_workspace_created | workspace_id, created_at |
| conversations | conversations_workspace | workspace_id |
| messages | messages_conversation | conversation_id |
| workspace_members | members_user | user_id |

---

## Security Model

### Authentication

1. **Password Hashing**: bcrypt with cost factor 10
2. **Token-Based Auth**: JWT with 24-hour expiry
3. **Secure Transport**: HTTPS enforced in production

### Authorization

1. **Workspace Scoping**: All data operations scoped to user's workspaces
2. **Role-Based Access**: Owner, admin, member roles for team workspaces
3. **RLS Enforcement**: Database-level access control via Supabase

### Data Isolation

1. **Workspace Boundaries**: Users cannot access other workspace data
2. **JWT Claims**: Workspace ID validated on every request
3. **API Validation**: Input sanitization and schema validation

### API Security

1. **CORS**: Restricted to known frontend origins
2. **Rate Limiting**: Cloudflare Workers built-in protection
3. **Input Validation**: Zod schemas for request validation

---

## External Integrations

### Supabase

| Feature | Usage |
|---------|-------|
| Postgres | Primary database |
| Auth | JWT validation (custom implementation) |
| RLS | Row-level security policies |
| Realtime | Future: live updates |

### Cloudflare

| Service | Usage |
|---------|-------|
| Workers | Backend runtime |
| Vectorize | Vector embeddings and search |
| KV | Session storage (optional) |
| Pages | Frontend hosting |

### LLM Providers

| Provider | Usage |
|---------|-------|
| OpenAI | Embeddings (text-embedding-ada-002) |
| OpenRouter | LLM extraction (Claude, GPT-4, etc.) |
| Gemini | MAKER layer extraction |

---

## Deployment Architecture

### Production Stack

```
+-------------------+     +-------------------+
|  Cloudflare       |     |  Cloudflare       |
|  Pages            |     |  Workers          |
|  (Frontend)       |     |  (Backend)        |
+-------------------+     +-------------------+
         |                         |
         v                         v
+-------------------+     +-------------------+
|  CDN Edge         |     |  Workers Edge     |
|  (Global)         |     |  (Global)         |
+-------------------+     +-------------------+
                                   |
                    +--------------+--------------+
                    |              |              |
                    v              v              v
           +------------+  +------------+  +------------+
           | Supabase   |  | Vectorize  |  | OpenAI/    |
           | (Postgres) |  | (Vectors)  |  | OpenRouter |
           +------------+  +------------+  +------------+
```

### Deployment Commands

**Backend**:

```bash
cd apps/handoff/backend
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY
wrangler secret put JWT_SECRET
wrangler secret put OPENAI_API_KEY
npm run deploy
```

**Frontend**:

```bash
cd apps/handoff/frontend
npm run build
npm run deploy
```

### Environment Configuration

**Backend (`wrangler.toml`)**:

```toml
name = "handoff-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[vectorize]]
binding = "VECTORIZE"
index_name = "handoff-memories"

[vars]
ENVIRONMENT = "production"
```

**Frontend (`.env.production`)**:

```bash
VITE_API_URL=https://handoff-api.workers.dev
```

---

## Configuration Management

### Backend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase anon key |
| `JWT_SECRET` | Yes | JWT signing secret (32+ chars) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for extraction |
| `MAKER_ENABLED` | No | Enable MAKER layer (default: true) |
| `MAKER_REPLICAS` | No | Parallel agents (default: 3) |
| `MAKER_TEMPERATURE` | No | LLM temperature (default: 0.4) |
| `MAKER_MODEL` | No | Extraction model |

### Frontend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend API URL |

### Feature Flags

| Flag | Default | Description |
|------|---------|-------------|
| `MAKER_ENABLED` | true | Use MAKER for extraction |
| `TEAM_WORKSPACES` | true | Allow team workspace creation |
| `ADVANCED_SEARCH` | true | Enable semantic search |

---

## Performance Considerations

### Latency Optimization

1. **Edge Deployment**: Cloudflare Workers run close to users
2. **Connection Pooling**: Supabase connection reuse
3. **Embedding Cache**: Frequently used embeddings cached
4. **Lazy Loading**: Frontend loads data on demand

### Scalability

1. **Stateless Backend**: Workers scale automatically
2. **Database Connection Limits**: Supabase pooler for high concurrency
3. **Vector Index Sharding**: Vectorize handles scale automatically
4. **CDN Caching**: Static assets cached at edge

### Resource Limits

| Resource | Limit |
|----------|-------|
| Worker CPU | 50ms per request |
| Worker Memory | 128MB |
| Supabase Connections | Pool size configurable |
| Vectorize Queries | 1000/min |

---

## Future Considerations

1. **Real-time Updates**: Supabase Realtime for live memory updates

2. **Multi-Provider Import**: Support for Claude, Gemini, and other AI providers

3. **Memory Collaboration**: Shared workspaces with real-time editing

4. **Advanced Analytics**: Usage patterns and memory quality metrics

5. **Export Formats**: Multiple output formats for different LLM contexts

6. **Browser Extension**: Direct import from ChatGPT web interface (ToS-compliant)
