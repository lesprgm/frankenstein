// Shared types between frontend and backend

export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  ownerId: string
  createdAt: string
}

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  role: 'owner' | 'member'
  joinedAt: string
}

export interface Conversation {
  id: string
  workspaceId: string
  userId: string
  provider: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface Memory {
  id: string
  workspaceId: string
  type: string
  content: string
  confidence: number
  metadata: Record<string, any>
  createdAt: string
}

export interface Activity {
  id: string
  workspaceId: string
  userId: string
  userName: string
  type: 'import' | 'extraction' | 'chat' | 'member_added'
  details: Record<string, any>
  createdAt: string
}

// API Request/Response types

export interface SignupRequest {
  email: string
  password: string
  name: string
}

export interface SignupResponse {
  user: User
  token: string
  workspace: Workspace
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  user: User
  token: string
  workspaces: Workspace[]
}

export interface CreateWorkspaceRequest {
  name: string
  type: 'personal' | 'team'
}

export interface CreateWorkspaceResponse {
  workspace: Workspace
}

export interface AddMemberRequest {
  email: string
}

export interface AddMemberResponse {
  member: WorkspaceMember
}

export interface ImportRequest {
  workspaceId: string
}

export interface ImportResponse {
  jobId: string
  status: 'processing'
}

export interface ImportStatusResponse {
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

export interface GetMemoriesRequest {
  workspaceId: string
  type?: string[]
  limit?: number
  offset?: number
  search?: string
}

export interface GetMemoriesResponse {
  memories: Memory[]
  total: number
}

export interface GetConversationsRequest {
  workspaceId: string
  provider?: string
  limit?: number
  offset?: number
}

export interface GetConversationsResponse {
  conversations: Conversation[]
  total: number
}

export interface ChatRequest {
  workspaceId: string
  message: string
  conversationId?: string
}

export interface ChatResponse {
  response: string
  conversationId: string
  contextUsed: {
    memories: Memory[]
    tokenCount: number
    truncated: boolean
  }
}

export interface GetActivityRequest {
  workspaceId: string
  limit?: number
  userId?: string
}

export interface GetActivityResponse {
  activities: Activity[]
}

export interface ExportRequest {
  workspaceId: string
}

export interface ExportResponse {
  downloadUrl: string
  expiresAt: string
}

// Error types
export interface ApiError {
  error: string
  message: string
  statusCode: number
}
