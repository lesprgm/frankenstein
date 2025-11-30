import { DatabaseClient } from '../lib/db'

export interface Conversation {
  id: string
  workspace_id: string
  provider: string
  external_id: string | null
  title: string | null
  created_at: string
  updated_at: string
  raw_metadata: Record<string, any>
  user_id: string | null
  user_name?: string
  message_count: number
  memory_count: number
}

export interface GetConversationsParams {
  workspaceId: string
  provider?: string
  search?: string
  limit?: number
  offset?: number
}

export interface GetConversationsResult {
  conversations: Conversation[]
  total: number
}

export class ConversationService {
  constructor(private db: DatabaseClient) { }

  /**
   * Get conversations with filtering, search, and pagination
   */
  async getConversations(params: GetConversationsParams): Promise<GetConversationsResult> {
    const {
      workspaceId,
      provider,
      search,
      limit = 50,
      offset = 0
    } = params

    const isMock = process.env.USE_MOCK_SUPABASE === 'true'

    if (isMock) {
      const baseConditions: string[] = ['c.workspace_id = $1']
      const baseParams: any[] = [workspaceId]
      let idx = 2

      if (provider) {
        baseConditions.push(`c.provider = $${idx}`)
        baseParams.push(provider)
        idx++
      }

      if (search) {
        // Mock path: keep title search only to avoid pg-mem alias quirks with EXISTS
        baseConditions.push(`c.title ILIKE $${idx}`)
        baseParams.push(`%${search}%`)
        idx++
      }

      const whereClause = baseConditions.join(' AND ')

      const countRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM conversations c WHERE ${whereClause}`,
        baseParams
      )
      const total = parseInt(countRows[0]?.count || '0', 10)

      const conversations = await this.db.query<Conversation>(
        `
        SELECT 
          c.id,
          c.workspace_id,
          c.provider,
          c.external_id,
          c.title,
          c.created_at,
          c.updated_at,
          c.raw_metadata,
          c.user_id,
          u.name as user_name
        FROM conversations c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
        `,
        [...baseParams, limit, offset]
      )

      const messageCounts = await this.db.query<{ conversation_id: string; count: string }>(
        `
        SELECT conversation_id, COUNT(*)::text as count
        FROM messages
        WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace_id = $1)
        GROUP BY conversation_id
        `,
        [workspaceId]
      )
      const msgMap = new Map(messageCounts.map(r => [r.conversation_id, parseInt(r.count, 10)]))

      return {
        conversations: conversations.map(c => ({
          ...c,
          message_count: msgMap.get(c.id) ?? 0,
          memory_count: 0
        })),
        total
      }
    }

    // Build WHERE clause conditions
    const conditions: string[] = ['c.workspace_id = $1']
    const queryParams: any[] = [workspaceId]
    let paramIndex = 2

    // Filter by provider
    if (provider) {
      conditions.push(`c.provider = $${paramIndex}`)
      queryParams.push(provider)
      paramIndex++
    }

    // Search by content (search in title or message content)
    if (search) {
      conditions.push(`(
        c.title ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.conversation_id = c.id 
          AND m.content ILIKE $${paramIndex}
        )
      )`)
      queryParams.push(`%${search}%`)
      paramIndex++
    }

    const whereClause = conditions.join(' AND ')

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM conversations c
      WHERE ${whereClause}
    `
    console.log('[DEBUG] Count query:', countQuery, 'params:', queryParams)
    const countResult = await this.db.query<{ count: string }>(countQuery, queryParams)
    console.log('[DEBUG] Count result:', countResult)
    const total = parseInt(countResult[0]?.count || '0', 10)
    console.log('[DEBUG] Total:', total)

    // Get conversations with message count, memory count, and user attribution
    // Using correlated subqueries instead of LEFT JOINs to avoid query length issues
    const conversationsQuery = `
      SELECT 
        c.id,
        c.workspace_id,
        c.provider,
        c.external_id,
        c.title,
        c.created_at,
        c.updated_at,
        c.raw_metadata,
        c.user_id,
        u.name as user_name,
        (SELECT COUNT(*)::integer FROM messages m WHERE m.conversation_id = c.id) as message_count,
        0 as memory_count
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const conversations = await this.db.query<Conversation>(
      conversationsQuery,
      [...queryParams, limit, offset]
    )

    return {
      conversations,
      total
    }
  }

  /**
   * Get a single conversation by ID with messages and memories
   */
  async getConversationById(conversationId: string, workspaceId: string) {
    // Get conversation details
    const conversationQuery = `
      SELECT 
        c.id,
        c.workspace_id,
        c.provider,
        c.external_id,
        c.title,
        c.created_at,
        c.updated_at,
        c.raw_metadata,
        c.user_id,
        u.name as user_name
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = $1 AND c.workspace_id = $2
    `

    const conversationResult = await this.db.query<Conversation>(
      conversationQuery,
      [conversationId, workspaceId]
    )

    if (conversationResult.length === 0) {
      return null
    }

    const conversation = conversationResult[0]

    // Get messages
    const messagesQuery = `
      SELECT 
        id,
        conversation_id,
        role,
        content,
        created_at,
        raw_metadata
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `
    const messages = await this.db.query(messagesQuery, [conversationId])

    // Get memories
    const memoriesQuery = `
      SELECT 
        id,
        workspace_id,
        conversation_id,
        type,
        content,
        confidence,
        metadata,
        created_at
      FROM memories
      WHERE conversation_id = $1
      ORDER BY created_at DESC
    `
    const memories = await this.db.query(memoriesQuery, [conversationId])

    return {
      conversation,
      messages,
      memories
    }
  }

  /**
   * Batch fetch multiple conversations by IDs
   */
  async getBatchConversations(conversationIds: string[], workspaceId: string) {
    if (conversationIds.length === 0) {
      return []
    }

    // Create placeholders for the IN clause
    const placeholders = conversationIds.map((_, i) => `$${i + 2}`).join(', ')
    const messagePlaceholders = conversationIds.map((_, i) => `$${i + 1}`).join(', ')

    const query = `
      SELECT 
        c.id,
        c.workspace_id,
        c.provider,
        c.external_id,
        c.title,
        c.created_at,
        c.updated_at,
        c.raw_metadata,
        c.user_id,
        u.name as user_name
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.workspace_id = $1 AND c.id IN (${placeholders})
    `

    const conversations = await this.db.query<Conversation>(query, [workspaceId, ...conversationIds])

    // Fetch messages and memories for all conversations
    const messagesQuery = `
      SELECT 
        id,
        conversation_id,
        role,
        content,
        created_at,
        raw_metadata
      FROM messages
      WHERE conversation_id IN (${messagePlaceholders})
      ORDER BY created_at ASC
    `
    const allMessages = await this.db.query(messagesQuery, conversationIds)

    const memoriesQuery = `
      SELECT 
        id,
        workspace_id,
        conversation_id,
        type,
        content,
        confidence,
        metadata,
        created_at
      FROM memories
      WHERE conversation_id IN (${messagePlaceholders})
      ORDER BY created_at DESC
    `
    const allMemories = await this.db.query(memoriesQuery, conversationIds)

    // Group messages and memories by conversation_id
    const messagesByConv: Record<string, any[]> = allMessages.reduce((acc: Record<string, any[]>, msg: any) => {
      if (!acc[msg.conversation_id]) acc[msg.conversation_id] = []
      acc[msg.conversation_id].push(msg)
      return acc
    }, {})

    const memoriesByConv: Record<string, any[]> = allMemories.reduce((acc: Record<string, any[]>, mem: any) => {
      if (!acc[mem.conversation_id]) acc[mem.conversation_id] = []
      acc[mem.conversation_id].push(mem)
      return acc
    }, {})

    // Return results in the same format as getConversationById
    return conversations.map(conv => ({
      conversation: conv,
      messages: messagesByConv[conv.id] || [],
      memories: memoriesByConv[conv.id] || []
    }))
  }

  /**
   * Get grouped conversations (grouped by normalized title)
   */
  async getGroupedConversations(params: GetConversationsParams) {
    const {
      workspaceId,
      provider,
      search,
      limit = 50,
      offset = 0
    } = params

    // Normalize titles and group
    const conditions: string[] = ['c.workspace_id = $1']
    const queryParams: any[] = [workspaceId]
    let paramIndex = 2

    if (provider) {
      conditions.push(`c.provider = $${paramIndex}`)
      queryParams.push(provider)
      paramIndex++
    }

    if (search) {
      conditions.push(`(\n        LOWER(TRIM(c.title)) ILIKE $${paramIndex} OR\n        EXISTS (\n          SELECT 1 FROM messages m \n          WHERE m.conversation_id = c.id \n          AND m.content ILIKE $${paramIndex}\n        )\n      )`)
      queryParams.push(`%${search.toLowerCase()}%`)
      paramIndex++
    }

    const whereClause = conditions.join(' AND ')

    // Get grouped count
    const countQuery = `
      SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(c.title, 'Untitled Conversation')))) as count
      FROM conversations c
      WHERE ${whereClause}
    `
    const countResult = await this.db.query<{ count: string }>(countQuery, queryParams)
    const total = parseInt(countResult[0]?.count || '0', 10)

    // Get grouped conversations
    const groupedQuery = `
      SELECT 
        LOWER(TRIM(COALESCE(c.title, 'Untitled Conversation'))) as title_normalized,
        COALESCE(c.title, 'Untitled Conversation') as title,
        ARRAY_AGG(c.id ORDER BY c.created_at DESC) as conversation_ids,
        COUNT(*) as segment_count,
        SUM((SELECT COUNT(*)::integer FROM messages m WHERE m.conversation_id = c.id)) as total_messages,
        MAX(c.created_at) as last_active,
        ARRAY_AGG(DISTINCT c.provider) as providers
      FROM conversations c
      WHERE ${whereClause}
      GROUP BY LOWER(TRIM(COALESCE(c.title, 'Untitled Conversation'))), COALESCE(c.title, 'Untitled Conversation')
      ORDER BY MAX(c.created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const groups = await this.db.query(groupedQuery, [...queryParams, limit, offset])

    return {
      groups: groups.map((g: any) => ({
        title: g.title,
        title_normalized: g.title_normalized,
        conversation_ids: g.conversation_ids,
        segment_count: parseInt(g.segment_count, 10),
        total_messages: parseInt(g.total_messages || '0', 10),
        total_memories: 0, // Could add subquery for this
        last_active: g.last_active,
        providers: g.providers
      })),
      total
    }
  }
}

