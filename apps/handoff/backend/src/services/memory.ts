import { DatabaseClient } from '../lib/db'
import { EmbeddingService } from './embedding'

export interface Memory {
  id: string
  workspace_id: string
  conversation_id: string | null
  type: string
  content: string
  confidence: number
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  // Attribution fields for team workspaces
  user_id?: string
  user_name?: string
  // Vector embedding for semantic search
  embedding?: number[]
}

export interface GetMemoriesParams {
  workspaceId: string
  types?: string[]
  startDate?: string
  endDate?: string
  search?: string
  limit?: number
  offset?: number
}

export interface GetMemoriesResult {
  memories: Memory[]
  total: number
}

export class MemoryService {
  private embeddingService: EmbeddingService | null = null

  constructor(
    private db: DatabaseClient,
    embeddingService?: EmbeddingService
  ) {
    this.embeddingService = embeddingService || null
  }

  /**
   * Get memories with filtering, search, and pagination
   */
  async getMemories(params: GetMemoriesParams): Promise<GetMemoriesResult> {
    const {
      workspaceId,
      types,
      startDate,
      endDate,
      search,
      limit = 50,
      offset = 0
    } = params

    // Build WHERE clause conditions
    const conditions: string[] = ['m.workspace_id = $1']
    const queryParams: any[] = [workspaceId]
    let paramIndex = 2

    const isMock = process.env.USE_MOCK_SUPABASE === 'true'

    // Filter by type
    if (types && types.length > 0) {
      if (isMock) {
        const placeholders = types.map((_, idx) => `$${paramIndex + idx}`).join(', ')
        conditions.push(`m.type IN (${placeholders})`)
        queryParams.push(...types)
        paramIndex += types.length
      } else {
        conditions.push(`m.type = ANY($${paramIndex}::text[])`)
        queryParams.push(types)
        paramIndex++
      }
    }

    // Filter by date range
    if (startDate) {
      conditions.push(`m.created_at >= $${paramIndex}`)
      queryParams.push(startDate)
      paramIndex++
    }

    if (endDate) {
      conditions.push(`m.created_at <= $${paramIndex}`)
      queryParams.push(endDate)
      paramIndex++
    }

    // Search by content
    if (search) {
      conditions.push(`m.content ILIKE $${paramIndex}`)
      queryParams.push(`%${search}%`)
      paramIndex++
    }

    const whereClause = conditions.join(' AND ')

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM memories m
      WHERE ${whereClause}
    `
    const countResult = await this.db.query<{ count: string }>(countQuery, queryParams)
    const total = parseInt(countResult[0]?.count || '0', 10)

    // Get memories with attribution (user info from conversations)
    const memoriesQuery = `
      SELECT 
        m.id,
        m.workspace_id,
        m.conversation_id,
        m.type,
        m.content,
        m.confidence,
        m.metadata,
        m.created_at,
        m.updated_at,
        c.user_id,
        u.name as user_name
      FROM memories m
      LEFT JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const memories = await this.db.query<Memory>(
      memoriesQuery,
      [...queryParams, limit, offset]
    )

    return {
      memories,
      total
    }
  }

  /**
   * Get a single memory by ID with relationships
   */
  async getMemoryById(memoryId: string, workspaceId: string): Promise<Memory | null> {
    const query = `
      SELECT 
        m.id,
        m.workspace_id,
        m.conversation_id,
        m.type,
        m.content,
        m.confidence,
        m.metadata,
        m.created_at,
        m.updated_at,
        c.user_id,
        u.name as user_name
      FROM memories m
      LEFT JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE m.id = $1 AND m.workspace_id = $2
    `

    const result = await this.db.query<Memory>(query, [memoryId, workspaceId])
    return result[0] || null
  }

  /**
   * Update a memory
   */
  async updateMemory(memoryId: string, workspaceId: string, updates: Partial<Memory>): Promise<Memory | null> {
    // Only allow updating content and metadata for now
    const allowedUpdates = ['content', 'metadata']
    const updateFields: string[] = []
    const values: any[] = []
    let paramIndex = 1

    for (const key of Object.keys(updates)) {
      if (allowedUpdates.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`)
        if (key === 'metadata') {
          values.push(JSON.stringify((updates as any)[key]))
        } else {
          values.push((updates as any)[key])
        }
        paramIndex++
      }
    }

    if (updateFields.length === 0) {
      return this.getMemoryById(memoryId, workspaceId)
    }

    updateFields.push(`updated_at = NOW()`)

    // Add ID and workspace_id to values for WHERE clause
    values.push(memoryId)
    values.push(workspaceId)

    const query = `
      UPDATE memories
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}
      RETURNING *
    `

    const result = await this.db.query<Memory>(query, values)
    return result[0] || null
  }

  /**
   * Create a new memory
   */
  async createMemory(
    workspaceId: string,
    conversationId: string | null,
    type: string,
    content: string,
    confidence: number,
    metadata: Record<string, any> = {},
    userId?: string,
    userName?: string
  ): Promise<Memory> {
    // Generate embedding if service is available
    let embedding: number[] | null = null
    if (this.embeddingService) {
      try {
        embedding = await this.embeddingService.generateEmbedding(content)
      } catch (error) {
        console.error('Failed to generate embedding, memory will be created without it:', error)
        // Continue without embedding rather than failing the entire operation
      }
    }

    const query = `
      INSERT INTO memories (
        workspace_id, conversation_id, type, content, confidence, metadata, user_id, user_name, embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `

    const result = await this.db.query<Memory>(query, [
      workspaceId,
      conversationId,
      type,
      content,
      confidence,
      JSON.stringify(metadata),
      userId || null,
      userName || null,
      embedding ? JSON.stringify(embedding) : null
    ])

    return result[0]
  }
}
