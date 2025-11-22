# Handoff Application Design

## Overview

Handoff is a web application that demonstrates the MemoryLayer skeleton's flexibility by supporting both personal and team AI memory workspaces. It provides a clean interface for importing conversations, browsing memories, and chatting with context-aware AI. The application is built with React + TypeScript on the frontend and Cloudflare Workers + Hono on the backend.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Handoff Frontend                        │
│           (React + TypeScript + Vite + Tailwind)         │
│                                                          │
│  Components:                                             │
│  - WorkspaceSwitcher                                     │
│  - ImportView                                            │
│  - MemoryTimeline                                        │
│  - ChatInterface                                         │
│  - ConversationsList                                     │
│  - TeamActivity (team workspaces only)                   │
│  - Settings                                              │
└─────────────────────────────────────────────────────────┘
                           │
                      HTTP/REST API
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Handoff Backend                         │
│            (Cloudflare Workers + Hono)                   │
│                                                          │
│  Routes:                                                 │
│  - POST /auth/signup                                     │
│  - POST /auth/login                                      │
│  - GET  /workspaces                                      │
│  - POST /workspaces                                      │
│  - POST /workspaces/:id/members                          │
│  - POST /import                                          │
│  - GET  /conversations                                   │
│  - GET  /memories                                        │
│  - GET  /activity                                        │
│  - POST /chat                                            │
│  - POST /export                                          │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              MemoryLayer Skeleton                        │
│              (packages/core/*)                           │
│                                                          │
│  - StorageClient (workspace-scoped)                      │
│  - ChatCapture (multi-provider)                          │
│  - MemoryExtractor (personal_default / team_default)     │
│  - ContextEngine (workspace-scoped search)               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Infrastructure                         │
│                                                          │
│  - Supabase Postgres (users, workspaces, memories)      │
│  - Cloudflare Vectorize (embeddings)                    │
│  - OpenAI API (extraction + embeddings + chat)          │
└─────────────────────────────────────────────────────────┘
```

## Frontend Design

### Technology Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: React Context + hooks
- **Routing**: React Router
- **HTTP Client**: Fetch API with custom wrapper
- **UI Components**: Headless UI + custom components

### Component Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx              # App header with workspace switcher
│   │   ├── Sidebar.tsx             # Navigation sidebar
│   │   └── Layout.tsx              # Main layout wrapper
│   ├── workspace/
│   │   ├── WorkspaceSwitcher.tsx   # Dropdown to switch workspaces
│   │   ├── CreateWorkspace.tsx     # Modal for creating workspaces
│   │   └── WorkspaceSettings.tsx   # Workspace settings and members
│   ├── import/
│   │   ├── FileUpload.tsx          # Drag-and-drop file upload
│   │   ├── ImportProgress.tsx      # Progress bar and status
│   │   └── ImportResults.tsx       # Summary of import results
│   ├── memory/
│   │   ├── MemoryTimeline.tsx      # Timeline view of memories
│   │   ├── MemoryCard.tsx          # Individual memory display
│   │   ├── MemoryFilters.tsx       # Filter by type, date, etc.
│   │   └── MemorySearch.tsx        # Search memories
│   ├── chat/
│   │   ├── ChatInterface.tsx       # Main chat UI
│   │   ├── MessageList.tsx         # List of messages
│   │   ├── MessageInput.tsx        # Input for new messages
│   │   ├── ContextPanel.tsx        # Show memories used for context
│   │   └── ContextMemoryCard.tsx   # Memory card in context panel
│   ├── conversation/
│   │   ├── ConversationsList.tsx   # List of imported conversations
│   │   ├── ConversationCard.tsx    # Conversation preview
│   │   └── ConversationView.tsx    # Full conversation display
│   ├── activity/
│   │   ├── ActivityFeed.tsx        # Team activity feed
│   │   └── ActivityItem.tsx        # Individual activity item
│   └── settings/
│       ├── Settings.tsx            # Settings page
│       ├── DataExport.tsx          # Export data
│       └── DeleteWorkspace.tsx     # Delete workspace
├── contexts/
│   ├── AuthContext.tsx             # Authentication state
│   ├── WorkspaceContext.tsx        # Current workspace state
│   └── ThemeContext.tsx            # Theme preferences
├── hooks/
│   ├── useAuth.ts                  # Authentication hook
│   ├── useWorkspace.ts             # Workspace operations
│   ├── useImport.ts                # Import operations
│   ├── useMemories.ts              # Memory operations
│   ├── useChat.ts                  # Chat operations
│   └── useActivity.ts              # Activity feed
├── lib/
│   ├── api.ts                      # API client
│   ├── types.ts                    # TypeScript types
│   └── utils.ts                    # Utility functions
├── pages/
│   ├── Login.tsx                   # Login page
│   ├── Signup.tsx                  # Signup page
│   ├── Dashboard.tsx               # Main dashboard
│   ├── Import.tsx                  # Import page
│   ├── Memories.tsx                # Memories page
│   ├── Chat.tsx                    # Chat page
│   ├── Conversations.tsx           # Conversations page
│   ├── Activity.tsx                # Activity page (team only)
│   └── Settings.tsx                # Settings page
└── App.tsx                         # Root component
```

### Key Components

#### WorkspaceSwitcher

```typescript
interface WorkspaceSwitcherProps {
  workspaces: Workspace[]
  currentWorkspace: Workspace
  onSwitch: (workspaceId: string) => void
}

// Displays dropdown with all user's workspaces
// Shows workspace type (personal/team) with icon
// Highlights current workspace
// Includes "Create Workspace" option
```

#### ChatInterface

```typescript
interface ChatInterfaceProps {
  workspaceId: string
}

// Main chat UI with message list and input
// Shows context panel on the right
// Displays which memories are being used
// Handles streaming responses
// Extracts memories from new conversations
```

#### MemoryTimeline

```typescript
interface MemoryTimelineProps {
  workspaceId: string
  filters?: MemoryFilters
}

// Displays memories in reverse chronological order
// Supports infinite scroll
// Shows memory type, content, confidence
// Links to source conversation
// Shows attribution in team workspaces
```

### State Management

#### AuthContext

```typescript
interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
}
```

#### WorkspaceContext

```typescript
interface WorkspaceContextValue {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  switchWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string, type: 'personal' | 'team') => Promise<Workspace>
  addMember: (workspaceId: string, email: string) => Promise<void>
  refreshWorkspaces: () => Promise<void>
}
```

### Routing

```typescript
const routes = [
  { path: '/login', component: Login, public: true },
  { path: '/signup', component: Signup, public: true },
  { path: '/', component: Dashboard, protected: true },
  { path: '/import', component: Import, protected: true },
  { path: '/memories', component: Memories, protected: true },
  { path: '/chat', component: Chat, protected: true },
  { path: '/conversations', component: Conversations, protected: true },
  { path: '/conversations/:id', component: ConversationView, protected: true },
  { path: '/activity', component: Activity, protected: true },
  { path: '/settings', component: Settings, protected: true }
]
```

## Backend Design

### Technology Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (lightweight web framework)
- **Database**: Supabase Postgres
- **Vector Store**: Cloudflare Vectorize
- **AI**: OpenAI API
- **Authentication**: JWT tokens

### API Routes

#### Authentication

```typescript
// POST /auth/signup
interface SignupRequest {
  email: string
  password: string
  name: string
}

interface SignupResponse {
  user: User
  token: string
  workspace: Workspace  // Auto-created personal workspace
}

// POST /auth/login
interface LoginRequest {
  email: string
  password: string
}

interface LoginResponse {
  user: User
  token: string
  workspaces: Workspace[]
}
```

#### Workspaces

```typescript
// GET /workspaces
interface GetWorkspacesResponse {
  workspaces: Workspace[]
}

// POST /workspaces
interface CreateWorkspaceRequest {
  name: string
  type: 'personal' | 'team'
}

interface CreateWorkspaceResponse {
  workspace: Workspace
}

// POST /workspaces/:id/members
interface AddMemberRequest {
  email: string
}

interface AddMemberResponse {
  member: WorkspaceMember
}
```

#### Import

```typescript
// POST /import
interface ImportRequest {
  file: File  // Multipart form data
  workspaceId: string
}

interface ImportResponse {
  jobId: string
  status: 'processing'
}

// GET /import/:jobId
interface ImportStatusResponse {
  jobId: string
  status: 'processing' | 'completed' | 'failed'
  progress: {
    conversationsProcessed: number
    totalConversations: number
    memoriesExtracted: number
  }
  result?: {
    conversations: number
    memories: number
    errors: string[]
  }
}
```

#### Memories

```typescript
// GET /memories
interface GetMemoriesRequest {
  workspaceId: string
  type?: string[]
  limit?: number
  offset?: number
  search?: string
}

interface GetMemoriesResponse {
  memories: Memory[]
  total: number
}

// GET /memories/:id
interface GetMemoryResponse {
  memory: Memory
  relationships: Relationship[]
  sourceConversation: Conversation
}
```

#### Conversations

```typescript
// GET /conversations
interface GetConversationsRequest {
  workspaceId: string
  provider?: string
  limit?: number
  offset?: number
}

interface GetConversationsResponse {
  conversations: Conversation[]
  total: number
}

// GET /conversations/:id
interface GetConversationResponse {
  conversation: Conversation
  messages: Message[]
  memories: Memory[]
}
```

#### Chat

```typescript
// POST /chat
interface ChatRequest {
  workspaceId: string
  message: string
  conversationId?: string  // For continuing conversations
}

interface ChatResponse {
  response: string
  conversationId: string
  contextUsed: {
    memories: Memory[]
    tokenCount: number
    truncated: boolean
  }
}
```

#### Activity

```typescript
// GET /activity
interface GetActivityRequest {
  workspaceId: string
  limit?: number
  userId?: string  // Filter by user
}

interface GetActivityResponse {
  activities: Activity[]
}

interface Activity {
  id: string
  type: 'import' | 'extraction' | 'chat' | 'member_added'
  userId: string
  userName: string
  details: Record<string, any>
  createdAt: string
}
```

#### Export

```typescript
// POST /export
interface ExportRequest {
  workspaceId: string
}

interface ExportResponse {
  downloadUrl: string
  expiresAt: string
}
```

### Backend Services

#### AuthService

```typescript
class AuthService {
  async signup(email: string, password: string, name: string): Promise<SignupResult>
  async login(email: string, password: string): Promise<LoginResult>
  async verifyToken(token: string): Promise<User>
  async hashPassword(password: string): Promise<string>
  async comparePassword(password: string, hash: string): Promise<boolean>
}
```

#### WorkspaceService

```typescript
class WorkspaceService {
  constructor(
    private storageClient: StorageClient
  ) {}
  
  async createWorkspace(userId: string, name: string, type: WorkspaceType): Promise<Workspace>
  async getUserWorkspaces(userId: string): Promise<Workspace[]>
  async addMember(workspaceId: string, email: string): Promise<void>
  async isMember(workspaceId: string, userId: string): Promise<boolean>
}
```

#### ImportService

```typescript
class ImportService {
  constructor(
    private chatCapture: ChatCapture,
    private storageClient: StorageClient,
    private memoryExtractor: MemoryExtractor
  ) {}
  
  async importFile(file: File, workspaceId: string, userId: string): Promise<ImportJob>
  async processImport(jobId: string): Promise<void>
  async getImportStatus(jobId: string): Promise<ImportStatus>
}
```

#### ChatService

```typescript
class ChatService {
  constructor(
    private contextEngine: ContextEngine,
    private storageClient: StorageClient,
    private memoryExtractor: MemoryExtractor,
    private openai: OpenAI
  ) {}
  
  async chat(message: string, workspaceId: string, conversationId?: string): Promise<ChatResult>
  private async buildContext(message: string, workspaceId: string): Promise<string>
  private async extractMemories(messages: Message[], workspaceId: string): Promise<void>
}
```

## MemoryLayer Integration

### Initialization

```typescript
// Initialize MemoryLayer components
const storageClient = new StorageClient({
  postgres: {
    url: env.SUPABASE_URL
  },
  vectorize: {
    accountId: env.VECTORIZE_ACCOUNT_ID,
    apiToken: env.VECTORIZE_API_TOKEN,
    indexName: 'handoff-memories'
  }
})

const chatCapture = new ChatCapture({
  maxFileSize: 50 * 1024 * 1024,
  enableAutoDetection: true
})

const memoryExtractor = new MemoryExtractor({
  provider: new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }),
  strategy: new StructuredOutputStrategy(),
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.6
})

// Register extraction profiles
memoryExtractor.registerProfile('personal_default', {
  strategy: new StructuredOutputStrategy(),
  provider: openaiProvider,
  modelParams: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 2000
  },
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.6
})

memoryExtractor.registerProfile('team_default', {
  strategy: new StructuredOutputStrategy(),
  provider: openaiProvider,
  modelParams: {
    model: 'gpt-4o',
    temperature: 0.2,
    maxTokens: 3000
  },
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.7
})

const contextEngine = new ContextEngine({
  storageClient,
  embeddingProvider: new OpenAIEmbeddingProvider({
    apiKey: env.OPENAI_API_KEY
  }),
  defaultTemplate: 'chat',
  defaultTokenBudget: 1500
})
```

### Workspace-Specific Configuration

```typescript
// Select extraction profile based on workspace type
function getExtractionProfile(workspace: Workspace): string {
  return workspace.type === 'personal' ? 'personal_default' : 'team_default'
}

// Extract memories with workspace-appropriate profile
async function extractMemories(
  conversations: NormalizedConversation[],
  workspace: Workspace
) {
  const profile = getExtractionProfile(workspace)
  
  const result = await memoryExtractor.extractBatch(
    conversations,
    workspace.id,
    { profile }
  )
  
  return result
}
```

### Context Building

```typescript
// Build context for chat with workspace scoping
async function buildChatContext(
  message: string,
  workspace: Workspace
): Promise<string> {
  const tokenBudget = workspace.type === 'personal' ? 1500 : 2500
  const template = workspace.type === 'personal' ? 'chat' : 'detailed'
  
  const result = await contextEngine.buildContext(
    message,
    workspace.id,
    {
      template,
      tokenBudget,
      includeRelationships: true
    }
  )
  
  if (!result.ok) {
    return ''  // Degrade gracefully
  }
  
  return result.value.context
}
```

## Data Flow Examples

### Import Flow

```
1. User uploads file in Import UI
2. Frontend sends file to POST /import
3. Backend:
   a. Validates user has access to workspace
   b. Creates import job
   c. Calls ChatCapture.parseFileAuto()
   d. Stores conversations via StorageClient
   e. Queues memory extraction job
4. Background worker:
   a. Calls MemoryExtractor.extractBatch()
   b. Stores memories via StorageClient
   c. Updates import job status
5. Frontend polls GET /import/:jobId for status
6. Shows completion notification
```

### Chat Flow

```
1. User types message in Chat UI
2. Frontend sends to POST /chat
3. Backend:
   a. Validates workspace access
   b. Calls ContextEngine.buildContext()
   c. Formats prompt with context
   d. Calls OpenAI API
   e. Extracts memories from exchange
   f. Stores conversation and memories
4. Returns response with context metadata
5. Frontend displays response and context panel
```

### Workspace Switch Flow

```
1. User clicks workspace in switcher
2. Frontend updates WorkspaceContext
3. All components re-render with new workspace
4. API calls include new workspaceId
5. Data refreshes for new workspace
```

## Deployment

### Frontend Deployment (Cloudflare Pages)

```bash
# Build
npm run build

# Deploy
wrangler pages deploy dist
```

### Backend Deployment (Cloudflare Workers)

```bash
# Deploy
wrangler deploy
```

### Environment Variables

```
# Backend (Cloudflare Workers)
SUPABASE_URL=
SUPABASE_KEY=
VECTORIZE_ACCOUNT_ID=
VECTORIZE_API_TOKEN=
OPENAI_API_KEY=
JWT_SECRET=

# Frontend (Cloudflare Pages)
VITE_API_URL=
```

## Testing Strategy

### Frontend Tests

- Component tests with React Testing Library
- Integration tests for key flows (import, chat)
- E2E tests with Playwright

### Backend Tests

- Unit tests for services
- Integration tests with test database
- API endpoint tests

### MemoryLayer Integration Tests

- Test workspace scoping
- Test profile selection
- Test context building
- Test memory extraction

## Performance Considerations

- Lazy load components
- Infinite scroll for long lists
- Debounce search inputs
- Cache workspace data
- Optimize bundle size
- Use CDN for static assets
- Background jobs for heavy operations (import, extraction)

## Security Considerations

- JWT authentication
- Workspace access validation on every request
- Row-level security in Supabase
- Input validation and sanitization
- Rate limiting on API endpoints
- CORS configuration
- Secure password hashing (bcrypt)
