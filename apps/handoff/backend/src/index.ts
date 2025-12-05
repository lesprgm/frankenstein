import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DatabaseClient } from './lib/db'
import { AuthService } from './services/auth'
import { WorkspaceService } from './services/workspace'
import { ImportService } from './services/import'
import { MemoryService } from './services/memory'
import { ConversationService } from './services/conversation'
import { ActivityService } from './services/activity'
import { ExportService } from './services/export'
import { ChatService } from './services/chat'
import { ChatConversationService } from './services/chat-conversation'
import { EmbeddingService } from './services/embedding'
import { SignupRequest, LoginRequest, User } from './types/auth'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_KEY: string
  VECTORIZE_ACCOUNT_ID: string
  VECTORIZE_API_TOKEN: string
  OPENAI_API_KEY: string
  OPENROUTER_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_CHAT_MODEL?: string
  OPENAI_EXTRACTION_MODEL_PERSONAL?: string
  OPENAI_EXTRACTION_MODEL_TEAM?: string
  JWT_SECRET: string
}

type Variables = {
  user: User
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CORS middleware
app.use('/*', cors())

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Handoff API',
    version: '0.1.0',
    status: 'ok'
  })
})

app.get('/api/health', (c) => {
  return c.json({ status: 'healthy' })
})

// Helper to get services for a request
function getServices(c: any) {
  const openaiApiKey = c.env.OPENAI_API_KEY || c.env.OPENROUTER_API_KEY
  const openaiBaseUrl = c.env.OPENAI_BASE_URL || (c.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined)
  const openaiChatModel = c.env.OPENAI_CHAT_MODEL || (c.env.OPENROUTER_API_KEY ? 'google/gemini-2.5-pro' : 'gpt-4o')

  // In runtime, always use the real Supabase DB (no mock)
  const db = new DatabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, { mockMode: false })
  const authService = new AuthService(db, c.env.JWT_SECRET)
  const activityService = new ActivityService(db)

  async function logActivity(workspaceId: string, userId: string, type: string, details: any) {
    await activityService.logActivity(workspaceId, userId, type as any, details)
  }

  const workspaceService = new WorkspaceService(db, logActivity)
  const conversationService = new ConversationService(db)
  const exportService = new ExportService(db)
  const chatConversationService = new ChatConversationService(db)

  // Initialize EmbeddingService if API key is available
  const embeddingService = c.env.OPENAI_API_KEY
    ? new EmbeddingService(
      c.env.OPENAI_API_KEY,
      c.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      c.env.OPENAI_BASE_URL
    )
    : undefined

  const memoryService = new MemoryService(db, embeddingService)

  const importService = new ImportService(
    db,
    openaiApiKey,
    {
      baseURL: openaiBaseUrl,
      chatModel: openaiChatModel,
      extractionModelPersonal: c.env.OPENAI_EXTRACTION_MODEL_PERSONAL,
      extractionModelTeam: c.env.OPENAI_EXTRACTION_MODEL_TEAM
    },
    logActivity
  )

  const chatService = new ChatService(
    db,
    openaiApiKey,
    openaiBaseUrl,
    openaiChatModel,
    embeddingService
  )

  return {
    db,
    authService,
    workspaceService,
    importService,
    memoryService,
    conversationService,
    activityService,
    exportService,
    chatService,
    chatConversationService,
    embeddingService
  }
}

// Auth middleware
async function requireAuth(c: any, next: any) {
  try {
    const { authService } = getServices(c)
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.substring(7)
    const user = await authService.getUserFromToken(token)

    c.set('user', user)
    await next()
  } catch (error) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
}

// Auth routes
app.post('/api/auth/signup', async (c) => {
  try {
    const { authService } = getServices(c)
    const body = await c.req.json<SignupRequest>()
    const { email, password, name } = body

    if (!email || !password || !name) {
      return c.json({ error: 'Email, password, and name are required' }, 400)
    }

    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }

    const result = await authService.signup(email, password, name)
    return c.json(result, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signup failed'
    return c.json({ error: message }, 400)
  }
})

app.post('/api/auth/login', async (c) => {
  try {
    const { authService } = getServices(c)
    const body = await c.req.json<LoginRequest>()
    const { email, password } = body

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    const result = await authService.login(email, password)
    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed'
    return c.json({ error: message }, 401)
  }
})

app.get('/api/auth/me', requireAuth, async (c) => {
  const user = c.get('user')
  return c.json({ user }, 200)
})

// Workspace routes
app.get('/api/workspaces', requireAuth, async (c) => {
  try {
    const { workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaces = await workspaceService.getUserWorkspaces(user.id)

    return c.json({ workspaces }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch workspaces'
    return c.json({ error: message }, 500)
  }
})

app.post('/api/workspaces', requireAuth, async (c) => {
  try {
    const { workspaceService } = getServices(c)
    const user = c.get('user')
    const { name } = await c.req.json<{ name: string }>();

    if (!name || name.trim() === '') {
      return c.json({ error: 'Workspace name is required' }, 400);
    }

    // Hardcoded to personal workspace for hackathon
    const workspace = await workspaceService.createWorkspace(user.id, name, 'personal');
    return c.json({ workspace }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create workspace'
    return c.json({ error: message }, 400)
  }
})

app.post('/api/workspaces/:id/members', requireAuth, async (c) => {
  try {
    const { workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaceId = c.req.param('id')
    const body = await c.req.json<{ email: string }>()
    const { email } = body

    if (!email) {
      return c.json({ error: 'Email is required' }, 400)
    }

    const member = await workspaceService.addMember(workspaceId, email, user.id)
    return c.json({ member }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add member'
    const status = message.includes('not found') ? 404 :
      message.includes('access') ? 403 : 400
    return c.json({ error: message }, status)
  }
})

app.get('/api/workspaces/:id/members', requireAuth, async (c) => {
  try {
    const { workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaceId = c.req.param('id')

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const members = await workspaceService.getWorkspaceMembers(workspaceId)
    return c.json({ members }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch members'
    return c.json({ error: message }, 500)
  }
})

app.delete('/api/workspaces/:id', requireAuth, async (c) => {
  try {
    const { workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaceId = c.req.param('id')

    await workspaceService.deleteWorkspace(workspaceId, user.id)
    return c.json({ message: 'Workspace deleted successfully' }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete workspace'
    const status = message.includes('not found') ? 404 :
      message.includes('owner') ? 403 : 500
    return c.json({ error: message }, status)
  }
})

// Import routes
app.post('/api/import', requireAuth, async (c) => {
  try {
    const { importService, workspaceService } = getServices(c)
    const user = c.get('user')

    // Get workspace_id from request body or query
    const body = await c.req.parseBody()
    const workspaceId = body.workspace_id || body.workspaceId

    if (!workspaceId || typeof workspaceId !== 'string') {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Get file from multipart form data
    const file = body.file
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'File is required' }, 400)
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024
    if (file.size > maxSize) {
      return c.json({ error: 'File size exceeds 50MB limit' }, 400)
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Start import job
    const result = await importService.importFile(buffer, workspaceId, user.id)

    return c.json(result, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/import/:jobId', requireAuth, async (c) => {
  try {
    const { importService } = getServices(c)
    const user = c.get('user')
    const jobId = c.req.param('jobId')

    const job = importService.getImportStatus(jobId)

    if (!job) {
      return c.json({ error: 'Import job not found' }, 404)
    }

    // Verify user owns this job
    if (job.user_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    return c.json(job, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get import status'
    return c.json({ error: message }, 500)
  }
})

// Memory routes
app.post('/api/memories', requireAuth, async (c) => {
  try {
    const { memoryService, workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const body = await c.req.json<{ content: string; type: string; metadata?: Record<string, any> }>()

    if (!body.content || !body.type) {
      return c.json({ error: 'content and type are required' }, 400)
    }

    const memory = await memoryService.createMemory(
      workspaceId,
      null, // conversationId
      body.type,
      body.content,
      1.0, // confidence (manual creation = 100%)
      body.metadata || {},
      user.id,
      user.email // using email as username for now
    )
    return c.json({ memory }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create memory'
    return c.json({ error: message }, 500)
  }
})

// Chat endpoint - AI-powered Q&A using memories
app.post('/api/chat', requireAuth, async (c) => {
  try {
    const { chatService, workspaceService } = getServices(c)
    const user = c.get('user')
    const body = await c.req.json<{
      message: string
      workspaceId: string
      history?: { role: 'user' | 'assistant'; content: string }[]
    }>()

    const { message, workspaceId, history = [] } = body

    if (!message || !workspaceId) {
      return c.json({ error: 'message and workspaceId are required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const response = await chatService.chat(message, workspaceId, history)
    return c.json(response, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get chat response'
    return c.json({ error: message }, 500)
  }
})

// Chat Conversation routes
app.post('/api/chat/conversations', requireAuth, async (c) => {
  try {
    const { chatConversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const body = await c.req.json<{ workspaceId: string; title?: string }>()

    if (!body.workspaceId) {
      return c.json({ error: 'workspaceId is required' }, 400)
    }

    // Validate workspace access
    const isMember = await workspaceService.isMember(body.workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const conversation = await chatConversationService.createConversation(
      body.workspaceId,
      body.title
    )
    return c.json({ conversation }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create conversation'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/chat/conversations', requireAuth, async (c) => {
  try {
    const { chatConversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate workspace access
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const result = await chatConversationService.listConversations(workspaceId, {
      limit,
      offset
    })
    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list conversations'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/chat/conversations/:id', requireAuth, async (c) => {
  try {
    const { chatConversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const conversationId = c.req.param('id')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate workspace access
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const conversation = await chatConversationService.getConversation(
      conversationId,
      workspaceId
    )

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    return c.json({ conversation }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get conversation'
    return c.json({ error: message }, 500)
  }
})

app.patch('/api/chat/conversations/:id', requireAuth, async (c) => {
  try {
    const { chatConversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const conversationId = c.req.param('id')
    const body = await c.req.json<{ workspaceId: string; title: string }>()

    if (!body.workspaceId || !body.title) {
      return c.json({ error: 'workspaceId and title are required' }, 400)
    }

    // Validate workspace access
    const isMember = await workspaceService.isMember(body.workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have  access to this workspace' }, 403)
    }

    const conversation = await chatConversationService.updateConversationTitle(
      conversationId,
      body.workspaceId,
      body.title
    )

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    return c.json({ conversation }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update conversation'
    return c.json({ error: message }, 500)
  }
})

app.delete('/api/chat/conversations/:id', requireAuth, async (c) => {
  try {
    const { chatConversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const conversationId = c.req.param('id')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate workspace access
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    await chatConversationService.deleteConversation(conversationId, workspaceId)
    return c.json({ success: true }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete conversation'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/memories', requireAuth, async (c) => {
  try {
    const { memoryService, workspaceService } = getServices(c)
    const user = c.get('user')

    // Get query parameters
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Parse filter parameters
    const typesParam = c.req.query('types')
    const typeParam = c.req.query('type')
    let types: string[] | undefined
    if (typesParam || typeParam) {
      const combined = [
        ...(typesParam ? typesParam.split(',') : []),
        ...(typeParam ? [typeParam] : [])
      ]
        .map((t) => t.trim())
        .filter(Boolean)
      types = combined.length ? Array.from(new Set(combined)) : undefined
    }

    const startDate = c.req.query('start_date') || c.req.query('startDate')
    const endDate = c.req.query('end_date') || c.req.query('endDate')
    const search = c.req.query('search')

    const limitParam = c.req.query('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 50

    const offsetParam = c.req.query('offset')
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: 'limit must be between 1 and 100' }, 400)
    }

    if (isNaN(offset) || offset < 0) {
      return c.json({ error: 'offset must be non-negative' }, 400)
    }

    // Fetch memories
    const result = await memoryService.getMemories({
      workspaceId,
      types,
      startDate,
      endDate,
      search,
      limit,
      offset
    })

    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch memories'
    return c.json({ error: message }, 500)
  }
})

app.get('/api/memories/:id', requireAuth, async (c) => {
  try {
    const { memoryService, workspaceService } = getServices(c)
    const user = c.get('user')
    const memoryId = c.req.param('id')

    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const memory = await memoryService.getMemoryById(memoryId, workspaceId)

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    return c.json({ memory }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch memory'
    return c.json({ error: message }, 500)
  }
})

app.patch('/api/memories/:id', requireAuth, async (c) => {
  try {
    const { memoryService, workspaceService } = getServices(c)
    const user = c.get('user')
    const memoryId = c.req.param('id')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const body = await c.req.json()
    const memory = await memoryService.updateMemory(memoryId, workspaceId, body)

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    return c.json({ memory }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update memory'
    return c.json({ error: message }, 500)
  }
})

// Conversation routes
app.get('/api/conversations', requireAuth, async (c) => {
  try {
    const { conversationService, workspaceService } = getServices(c)
    const user = c.get('user')

    // Get query parameters
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Parse filter parameters
    const provider = c.req.query('provider')
    const search = c.req.query('search')

    const limitParam = c.req.query('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 50

    const offsetParam = c.req.query('offset')
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: 'limit must be between 1 and 100' }, 400)
    }

    if (isNaN(offset) || offset < 0) {
      return c.json({ error: 'offset must be non-negative' }, 400)
    }

    // Fetch conversations
    const result = await conversationService.getConversations({
      workspaceId,
      provider,
      search,
      limit,
      offset
    })

    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch conversations'
    return c.json({ error: message }, 500)
  }
})

// Batch fetch conversations - MUST come before :id route
app.post('/api/conversations/batch', requireAuth, async (c) => {
  try {
    const { conversationService, workspaceService } = getServices(c)
    const user = c.get('user')

    const body = await c.req.json<{ ids: string[]; workspace_id?: string; workspaceId?: string }>()
    const conversationIds = body.ids
    const workspaceId = body.workspace_id || body.workspaceId

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return c.json({ error: 'ids array is required and must not be empty' }, 400)
    }

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const results = await conversationService.getBatchConversations(conversationIds, workspaceId)

    return c.json({ conversations: results }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch conversations'
    return c.json({ error: message }, 500)
  }
})

// Get grouped conversations - MUST come before :id route
app.get('/api/conversations/grouped', requireAuth, async (c) => {
  try {
    const { conversationService, workspaceService } = getServices(c)
    const user = c.get('user')

    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Parse filter parameters
    const provider = c.req.query('provider')
    const search = c.req.query('search')

    const limitParam = c.req.query('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 50

    const offsetParam = c.req.query('offset')
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: 'limit must be between 1 and 100' }, 400)
    }

    if (isNaN(offset) || offset < 0) {
      return c.json({ error: 'offset must be non-negative' }, 400)
    }

    // Fetch grouped conversations
    const result = await conversationService.getGroupedConversations({
      workspaceId,
      provider,
      search,
      limit,
      offset
    })

    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch grouped conversations'
    return c.json({ error: message }, 500)
  }
})

// Get single conversation by ID - MUST come after specific routes
app.get('/api/conversations/:id', requireAuth, async (c) => {
  try {
    const { conversationService, workspaceService } = getServices(c)
    const user = c.get('user')
    const conversationId = c.req.param('id')

    if (!conversationId || conversationId === 'undefined') {
      return c.json({ error: 'conversation id is required' }, 400)
    }

    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const result = await conversationService.getConversationById(conversationId, workspaceId)

    if (!result) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch conversation'
    return c.json({ error: message }, 500)
  }
})

// Handoff export: build a copyable context block (recent messages + top memories)
app.get('/api/handoff/export', requireAuth, async (c) => {
  try {
    const { conversationService, memoryService, workspaceService } = getServices(c)
    const user = c.get('user')
    const conversationId = c.req.query('conversation_id') || c.req.query('conversationId')
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!conversationId || !workspaceId) {
      return c.json({ error: 'conversation_id and workspace_id are required' }, 400)
    }

    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    const convo = await conversationService.getConversationById(conversationId, workspaceId)
    if (!convo) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    const toOneLine = (value: string, max = 160) => {
      const cleaned = (value || '').replace(/\s+/g, ' ').trim()
      if (cleaned.length <= max) return cleaned
      return `${cleaned.slice(0, max - 1)}…`
    }

    const relativeTime = (iso?: string) => {
      if (!iso) return ''
      const then = new Date(iso).getTime()
      const now = Date.now()
      const diff = Math.max(0, now - then)
      const minutes = Math.floor(diff / (1000 * 60))
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      return `${days}d ago`
    }

    // Build recent lines (last 3 turns, trimmed)
    type ConversationMessage = { role?: string; content?: string }
    const allMessages: ConversationMessage[] = (convo.messages as ConversationMessage[]) || []
    const recentMessages = allMessages.slice(-3)
    const recentLines = recentMessages.map((m) => {
      const role = m.role === 'assistant' ? 'Assistant' : 'User'
      return `${role}: ${toOneLine(m.content ?? '', 90)}`
    })

    // Last user message as task (optional)
    const lastUser = [...allMessages].reverse().find((m) => m.role !== 'assistant')
    const taskLine = lastUser ? `- Task: ${toOneLine(lastUser.content ?? '', 120)}` : ''

    // Fetch and rank memories
    const memoriesResult = await memoryService.getMemories({
      workspaceId,
      limit: 15,
      offset: 0
    })
    const seen = new Set<string>()
    const filtered = (memoriesResult.memories || [])
      .filter((m: any) => typeof m.content === 'string' && m.content.trim().length > 0)
      .filter((m: any) => m.confidence === null || m.confidence === undefined || m.confidence >= 0.5)
      .filter((m: any) => {
        const key = toOneLine(m.content, 120).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a: any, b: any) => {
        const confA = Number.isFinite(a.confidence) ? a.confidence : 0
        const confB = Number.isFinite(b.confidence) ? b.confidence : 0
        if (confA !== confB) return confB - confA
        const timeA = new Date(a.created_at || 0).getTime()
        const timeB = new Date(b.created_at || 0).getTime()
        return timeB - timeA
      })
      .slice(0, 6)

    const memoryLines = filtered.map((m: any, idx: number) => {
      const source =
        m.metadata?.title ||
        m.metadata?.name ||
        (m.conversation_id ? `convo ${m.conversation_id.slice(0, 8)}` : 'memory')
      const when = relativeTime(m.created_at)
      const confidence = Number.isFinite(m.confidence) ? `${Math.round(m.confidence * 100)}%` : ''
      const parts = [
        `${idx + 1}) ${toOneLine(m.content, 140)}`,
        m.type ? `type: ${m.type}` : '',
        source ? `source: ${source}` : '',
        when ? when : '',
        confidence ? `conf: ${confidence}` : ''
      ].filter(Boolean)
      return `  ${parts.join(' | ')}`
    })

    const handoff = [
      'Context for LLM',
      taskLine,
      recentLines.length ? `- Recent: ${recentLines.join(' | ')}` : '',
      memoryLines.length ? '- Key facts:' : '- Key facts: none found',
      ...memoryLines
    ]
      .filter((line) => line !== '')
      .join('\n')

    return c.json({
      handoff,
      conversation_id: conversationId,
      workspace_id: workspaceId
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build handoff context'
    return c.json({ error: message }, 500)
  }
})

// Activity routes
app.get('/api/activity', requireAuth, async (c) => {
  try {
    const { activityService, workspaceService } = getServices(c)
    const user = c.get('user')

    // Get query parameters
    const workspaceId = c.req.query('workspace_id') || c.req.query('workspaceId')

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Parse filter parameters
    const filterUserId = c.req.query('user_id') || c.req.query('userId')

    const limitParam = c.req.query('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 50

    const offsetParam = c.req.query('offset')
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: 'limit must be between 1 and 100' }, 400)
    }

    if (isNaN(offset) || offset < 0) {
      return c.json({ error: 'offset must be non-negative' }, 400)
    }

    // Fetch activities
    const result = await activityService.getActivities({
      workspaceId,
      userId: filterUserId,
      limit,
      offset
    })

    return c.json(result, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch activities'
    return c.json({ error: message }, 500)
  }
})

// Export routes
app.post('/api/export', requireAuth, async (c) => {
  try {
    const { exportService, workspaceService } = getServices(c)
    const user = c.get('user')

    // Get workspace_id from request body
    const body = await c.req.json<{ workspace_id?: string; workspaceId?: string }>()
    const workspaceId = body.workspace_id || body.workspaceId

    if (!workspaceId) {
      return c.json({ error: 'workspace_id is required' }, 400)
    }

    // Validate user has access to workspace
    const isMember = await workspaceService.isMember(workspaceId, user.id)
    if (!isMember) {
      return c.json({ error: 'You do not have access to this workspace' }, 403)
    }

    // Export workspace data
    const exportData = await exportService.exportWorkspaceData(workspaceId)

    // Create separate files for conversations, memories, and relationships
    const exportFiles = exportService.createExportFiles(exportData)

    // Create archive containing all files
    const archive = exportService.createArchive(exportFiles)

    // In a production environment, you would:
    // 1. Create a proper ZIP file using a library like JSZip or archiver
    // 2. Upload the ZIP to cloud storage (e.g., Cloudflare R2, AWS S3)
    // 3. Generate a temporary signed URL with expiration (e.g., 1 hour)
    // 4. Return the URL
    //
    // For this implementation, we'll return the archive data directly as a JSON container
    // The frontend can parse this and create individual downloads or a ZIP client-side

    // Create a data URL for immediate download
    const base64Data = Buffer.from(archive).toString('base64')
    const dataUrl = `data:application/json;base64,${base64Data}`

    // Calculate expiration (1 hour from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    return c.json({
      downloadUrl: dataUrl,
      expiresAt,
      filename: `handoff-export-${workspaceId}-${Date.now()}.json`,
      size: archive.length,
      format: 'json-archive',
      files: Object.keys(exportFiles),
      note: 'In production, this would be a ZIP file with a temporary signed URL to cloud storage'
    }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export data'
    return c.json({ error: message }, 500)
  }
})

export default app
