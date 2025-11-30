const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

export interface User {
  id: string
  email: string
  name: string
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  owner_id: string
  created_at: string
  updated_at: string
}

export interface SignupRequest {
  email: string
  password: string
  name: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  user: User
  token: string
  workspace?: Workspace
  workspaces?: Workspace[]
}

export interface CreateWorkspaceRequest {
  name: string
  type: 'personal' | 'team'
}

export interface AddMemberRequest {
  email: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  email: string
  joined_at: string
}

export interface ImportJob {
  id: string
  workspace_id: string
  user_id: string
  status: 'processing' | 'completed' | 'failed'
  progress: {
    conversationsProcessed: number
    totalConversations: number
    memoriesExtracted: number
  }
  result?: {
    conversations: number
    memories: number
    errors?: string[]
  }
  error?: string
  created_at: string
  updated_at: string
}

export interface ImportResult {
  jobId: string
  status: 'processing' | 'completed' | 'failed'
  result?: {
    conversations: number
    memories: number
    errors?: string[]
  }
  error?: string
}

export interface Conversation {
  id: string
  workspace_id: string
  provider: string
  external_id: string | null
  title: string | null
  created_at: string
  updated_at: string
  raw_metadata: Record<string, unknown>
  user_id: string | null
  user_name?: string
  message_count: number
  memory_count: number
}

export interface Message {
  id: string
  conversation_id: string
  role: string
  content: string
  created_at: string
  raw_metadata: Record<string, unknown>
}

export interface Memory {
  id: string
  workspace_id: string
  conversation_id: string | null
  type: 'entity' | 'fact' | 'decision'
  content: string
  confidence: number
  metadata: Record<string, any>
  created_at: string
}

export interface ChatConversation {
  id: string
  workspace_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  created_at: string
}

export interface ChatConversationWithMessages extends ChatConversation {
  messages: ChatMessage[]
}

export interface GetConversationsParams {
  workspaceId: string
  provider?: string
  search?: string
  limit?: number
  offset?: number
}

export interface GetConversationsResponse {
  conversations: Conversation[]
  total: number
}

export interface GetConversationResponse {
  conversation: Conversation
  messages: Message[]
  memories: Memory[]
}

export interface Activity {
  id: string
  workspace_id: string
  user_id: string
  user_name: string
  type: 'import' | 'extraction' | 'chat' | 'member_added'
  details: Record<string, unknown>
  created_at: string
  message: string
}

export interface GetActivitiesParams {
  workspaceId: string
  userId?: string
  limit?: number
  offset?: number
}

export interface GetActivitiesResponse {
  activities: Activity[]
  total: number
}

class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('auth_token')
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('auth_token', token)
  }

  clearToken() {
    this.token = null
    localStorage.removeItem('auth_token')
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (options.headers) {
      Object.assign(headers, options.headers)
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async signup(data: SignupRequest): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    this.setToken(response.token)
    return response
  }

  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    this.setToken(response.token)
    return response
  }

  async getCurrentUser(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/api/auth/me')
  }

  logout() {
    this.clearToken()
  }

  // Workspace endpoints
  async getWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    return this.request<{ workspaces: Workspace[] }>('/api/workspaces')
  }

  async createWorkspace(data: CreateWorkspaceRequest): Promise<{ workspace: Workspace }> {
    return this.request<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async addWorkspaceMember(workspaceId: string, data: AddMemberRequest): Promise<{ member: WorkspaceMember }> {
    return this.request<{ member: WorkspaceMember }>(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Import endpoints
  async importFile(file: File, workspaceId: string): Promise<ImportResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('workspace_id', workspaceId)

    const headers: Record<string, string> = {}
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}/api/import`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Import failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async getImportStatus(jobId: string): Promise<ImportJob> {
    return this.request<ImportJob>(`/api/import/${jobId}`)
  }

  // Conversation endpoints
  async getConversations(params: GetConversationsParams): Promise<GetConversationsResponse> {
    const queryParams = new URLSearchParams()
    queryParams.append('workspace_id', params.workspaceId)

    if (params.provider) {
      queryParams.append('provider', params.provider)
    }
    if (params.search) {
      queryParams.append('search', params.search)
    }
    if (params.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params.offset !== undefined) {
      queryParams.append('offset', params.offset.toString())
    }

    return this.request<GetConversationsResponse>(`/api/conversations?${queryParams.toString()}`)
  }

  async getConversationById(conversationId: string, workspaceId: string): Promise<GetConversationResponse> {
    return this.request<GetConversationResponse>(`/api/conversations/${conversationId}?workspace_id=${workspaceId}`)
  }

  // Handoff export: build a copyable context block for a conversation
  async getHandoffExport(params: { conversationId: string; workspaceId: string }): Promise<{ handoff: string }> {
    const query = new URLSearchParams({
      conversation_id: params.conversationId,
      workspace_id: params.workspaceId
    })
    return this.request<{ handoff: string }>(`/api/handoff/export?${query.toString()}`)
  }

  // Memory endpoints
  async getMemories(params: {
    workspaceId: string
    type?: string
    search?: string
    limit?: number
    offset?: number
  }): Promise<{ memories: Memory[]; total: number }> {
    const queryParams = new URLSearchParams()
    queryParams.append('workspace_id', params.workspaceId)

    if (params.type) {
      queryParams.append('type', params.type)
    }
    if (params.search) {
      queryParams.append('search', params.search)
    }
    if (params.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params.offset !== undefined) {
      queryParams.append('offset', params.offset.toString())
    }

    return this.request<{ memories: Memory[]; total: number }>(`/api/memories?${queryParams.toString()}`)
  }

  async getMemoryById(memoryId: string, workspaceId: string): Promise<{ memory: Memory }> {
    return this.request<{ memory: Memory }>(`/api/memories/${memoryId}?workspace_id=${workspaceId}`)
  }

  async updateMemory(memoryId: string, workspaceId: string, data: Partial<Memory>): Promise<{ memory: Memory }> {
    return this.request<{ memory: Memory }>(`/api/memories/${memoryId}?workspace_id=${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    })
  }

  async createMemory(workspaceId: string, data: { content: string; type: string; metadata?: Record<string, unknown> }): Promise<{ memory: Memory }> {
    return this.request<{ memory: Memory }>(`/api/memories?workspace_id=${workspaceId}`, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Activity endpoints
  async getActivities(params: GetActivitiesParams): Promise<GetActivitiesResponse> {
    const queryParams = new URLSearchParams()
    queryParams.append('workspace_id', params.workspaceId)

    if (params.userId) {
      queryParams.append('user_id', params.userId)
    }
    if (params.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params.offset !== undefined) {
      queryParams.append('offset', params.offset.toString())
    }

    return this.request<GetActivitiesResponse>(`/api/activity?${queryParams.toString()}`)
  }

  // Export endpoint
  async exportWorkspaceData(workspaceId: string): Promise<{
    downloadUrl: string
    expiresAt: string
    filename: string
    size: number
    format: string
    files: string[]
  }> {
    return this.request(`/api/export`, {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
  }

  // Batch fetch conversations
  async getBatchConversations(ids: string[], workspaceId: string): Promise<{
    conversations: Array<{
      conversation: Conversation
      messages: Message[]
      memories: Memory[]
    }>
  }> {
    return this.request(`/api/conversations/batch`, {
      method: 'POST',
      body: JSON.stringify({ ids, workspace_id: workspaceId })
    })
  }

  // Get grouped conversations
  async getGroupedConversations(params: GetConversationsParams): Promise<{
    groups: Array<{
      title: string
      title_normalized: string
      conversation_ids: string[]
      segment_count: number
      total_messages: number
      total_memories: number
      last_active: string
      providers: string[]
    }>
    total: number
  }> {
    const queryParams = new URLSearchParams()
    queryParams.append('workspace_id', params.workspaceId)

    if (params.provider) {
      queryParams.append('provider', params.provider)
    }
    if (params.search) {
      queryParams.append('search', params.search)
    }
    if (params.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params.offset !== undefined) {
      queryParams.append('offset', params.offset.toString())
    }

    return this.request(`/api/conversations/grouped?${queryParams.toString()}`)
  }

  // Workspace members endpoint
  async getWorkspaceMembers(workspaceId: string): Promise<{
    members: Array<{
      id: string
      user_id: string
      name: string
      email: string
      role: string
      created_at: string
    }>
  }> {
    return this.request(`/api/workspaces/${workspaceId}/members`)
  }

  // Chat endpoint
  async chat(params: { message: string; workspaceId: string; history?: any[] }): Promise<{ content: string; sources: Memory[] }> {
    return this.request<{ content: string; sources: Memory[] }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(params)
    })
  }

  // Delete workspace endpoint
  async deleteWorkspace(workspaceId: string): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}`, {
      method: 'DELETE',
    })
  }

  // Chat Conversation methods
  async createChatConversation(workspaceId: string, title?: string): Promise<{ conversation: ChatConversation }> {
    return this.request<{ conversation: ChatConversation }>('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, title })
    })
  }

  async listChatConversations(workspaceId: string, options?: { limit?: number; offset?: number }): Promise<{ conversations: ChatConversation[]; total: number }> {
    const params = new URLSearchParams({ workspaceId })
    if (options?.limit) params.append('limit', options.limit.toString())
    if (options?.offset) params.append('offset', options.offset.toString())

    return this.request<{ conversations: ChatConversation[]; total: number }>(`/api/chat/conversations?${params}`)
  }

  async getChatConversation(conversationId: string, workspaceId: string): Promise<{ conversation: ChatConversationWithMessages }> {
    return this.request<{ conversation: ChatConversationWithMessages }>(`/api/chat/conversations/${conversationId}?workspaceId=${workspaceId}`)
  }

  async updateChatConversation(conversationId: string, workspaceId: string, title: string): Promise<{ conversation: ChatConversation }> {
    return this.request<{ conversation: ChatConversation }>(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, title })
    })
  }

  async deleteChatConversation(conversationId: string, workspaceId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/chat/conversations/${conversationId}?workspaceId=${workspaceId}`, {
      method: 'DELETE'
    })
  }
}

export const api = new ApiClient(API_URL)
