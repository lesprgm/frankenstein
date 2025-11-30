import { DatabaseClient } from '../lib/db'

type ConversationRow = {
  id: string
  workspace_id: string
  provider: string
  external_id: string | null
  title: string | null
  created_at: string
  updated_at: string
  raw_metadata: Record<string, unknown>
  user_id: string | null
  user_name: string | null
}

type MessageRow = {
  id: string
  conversation_id: string
  role: string
  content: string
  created_at: string
  raw_metadata: Record<string, unknown>
}

export interface ExportData {
  conversations: any[]
  memories: any[]
  relationships: any[]
  metadata: {
    workspaceId: string
    exportedAt: string
    version: string
  }
}

export interface ExportFiles {
  'conversations.json': string
  'memories.json': string
  'relationships.json': string
  'metadata.json': string
}

export class ExportService {
  constructor(private db: DatabaseClient) {}

  /**
   * Export all data for a workspace
   */
  async exportWorkspaceData(workspaceId: string): Promise<ExportData> {
    const isMock = process.env.USE_MOCK_SUPABASE === 'true'

    let conversations: any[]

    if (isMock) {
      // Simpler two-step aggregation to avoid JSON SQL functions in pg-mem
      const baseConversations = await this.db.query<ConversationRow>(
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
        WHERE c.workspace_id = $1
        ORDER BY c.created_at DESC
        `,
        [workspaceId]
      )

      const messages = await this.db.query<MessageRow>(
        `
        SELECT 
          id,
          conversation_id,
          role,
          content,
          created_at,
          raw_metadata
        FROM messages
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE workspace_id = $1
        )
        ORDER BY created_at ASC
        `,
        [workspaceId]
      )

      const byConversation = new Map<string, MessageRow[]>()
      for (const msg of messages) {
        const arr = byConversation.get(msg.conversation_id) || []
        arr.push(msg)
        byConversation.set(msg.conversation_id, arr)
      }

      conversations = baseConversations.map((conv) => ({
        ...conv,
        messages: byConversation.get(conv.id) || []
      }))
    } else {
      // Export conversations with messages using SQL aggregation
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
          json_agg(
            json_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'created_at', m.created_at,
              'raw_metadata', m.raw_metadata
            ) ORDER BY m.created_at ASC
          ) FILTER (WHERE m.id IS NOT NULL) as messages
        FROM conversations c
        LEFT JOIN users u ON c.user_id = u.id
        LEFT JOIN messages m ON c.id = m.conversation_id
        WHERE c.workspace_id = $1
        GROUP BY c.id, u.name
        ORDER BY c.created_at DESC
      `
      conversations = await this.db.query(conversationsQuery, [workspaceId])
    }

    // Export memories
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
      WHERE m.workspace_id = $1
      ORDER BY m.created_at DESC
    `
    const memories = await this.db.query(memoriesQuery, [workspaceId])

    // Export relationships
    const relationshipsQuery = `
      SELECT 
        id,
        workspace_id,
        COALESCE(source_memory_id, from_memory_id) as source_memory_id,
        COALESCE(target_memory_id, to_memory_id) as target_memory_id,
        relationship_type,
        confidence,
        metadata,
        created_at
      FROM relationships
      WHERE workspace_id = $1
      ORDER BY created_at DESC
    `
    const relationships = await this.db.query(relationshipsQuery, [workspaceId])

    return {
      conversations,
      memories,
      relationships,
      metadata: {
        workspaceId,
        exportedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    }
  }

  /**
   * Create separate JSON files for export
   */
  createExportFiles(data: ExportData): ExportFiles {
    return {
      'conversations.json': JSON.stringify(data.conversations, null, 2),
      'memories.json': JSON.stringify(data.memories, null, 2),
      'relationships.json': JSON.stringify(data.relationships, null, 2),
      'metadata.json': JSON.stringify(data.metadata, null, 2)
    }
  }

  /**
   * Create a simple ZIP-like archive (TAR format would be ideal, but for simplicity we'll use a JSON container)
   * In production, this would use a proper ZIP library or cloud storage with multiple files
   */
  createArchive(files: ExportFiles): string {
    // Create a simple archive format that can be easily extracted
    const archive = {
      format: 'handoff-export-v1',
      files: files,
      created_at: new Date().toISOString()
    }
    return JSON.stringify(archive, null, 2)
  }

  /**
   * Create a combined JSON export (legacy format)
   */
  createExportJSON(data: ExportData): string {
    return JSON.stringify(data, null, 2)
  }
}
