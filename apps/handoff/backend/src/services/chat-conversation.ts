import { DatabaseClient } from '../lib/db'
import crypto from 'crypto'

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
    sources?: string[] // Memory IDs
    created_at: string
}

export interface ChatConversationWithMessages extends ChatConversation {
    messages: ChatMessage[]
}

export class ChatConversationService {
    constructor(private db: DatabaseClient) { }

    async createConversation(
        workspaceId: string,
        title?: string
    ): Promise<ChatConversation> {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()

        const query = `
      INSERT INTO chat_conversations (id, workspace_id, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `

        const result = await this.db.query<ChatConversation>(query, [
            id,
            workspaceId,
            title || null,
            now,
            now
        ])

        return result[0]
    }

    async saveMessage(
        conversationId: string,
        role: 'user' | 'assistant',
        content: string,
        sources?: string[]
    ): Promise<ChatMessage> {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()

        const query = `
      INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `

        const result = await this.db.query<ChatMessage>(query, [
            id,
            conversationId,
            role,
            content,
            sources ? JSON.stringify(sources) : null,
            now
        ])

        return result[0]
    }

    async getConversation(
        conversationId: string,
        workspaceId: string
    ): Promise<ChatConversationWithMessages | null> {
        // Get conversation
        const convQuery = `
      SELECT * FROM chat_conversations
      WHERE id = $1 AND workspace_id = $2
    `
        const conversations = await this.db.query<ChatConversation>(convQuery, [
            conversationId,
            workspaceId
        ])

        if (conversations.length === 0) {
            return null
        }

        // Get messages
        const msgQuery = `
      SELECT * FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `
        const messages = await this.db.query<ChatMessage>(msgQuery, [conversationId])

        return {
            ...conversations[0],
            messages
        }
    }

    async listConversations(
        workspaceId: string,
        options: {
            limit?: number
            offset?: number
        } = {}
    ): Promise<{ conversations: ChatConversation[]; total: number }> {
        const { limit = 50, offset = 0 } = options

        // Get total count
        const countQuery = `
      SELECT COUNT(*)::integer as count
      FROM chat_conversations
      WHERE workspace_id = $1
    `
        const countResult = await this.db.query<{ count: number }>(countQuery, [workspaceId])
        const total = countResult[0]?.count || 0

        // Get conversations
        const query = `
      SELECT * FROM chat_conversations
      WHERE workspace_id = $1
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
    `
        const conversations = await this.db.query<ChatConversation>(query, [
            workspaceId,
            limit,
            offset
        ])

        return { conversations, total }
    }

    async updateConversationTitle(
        conversationId: string,
        workspaceId: string,
        title: string
    ): Promise<ChatConversation | null> {
        const query = `
      UPDATE chat_conversations
      SET title = $1, updated_at = NOW()
      WHERE id = $2 AND workspace_id = $3
      RETURNING *
    `

        const result = await this.db.query<ChatConversation>(query, [
            title,
            conversationId,
            workspaceId
        ])

        return result[0] || null
    }

    async deleteConversation(
        conversationId: string,
        workspaceId: string
    ): Promise<boolean> {
        const query = `
      DELETE FROM chat_conversations
      WHERE id = $1 AND workspace_id = $2
    `

        await this.db.query(query, [conversationId, workspaceId])
        return true
    }

    // Generate title from first user message
    async generateTitle(content: string): Promise<string> {
        // Simple title generation - take first 50 chars
        const title = content.trim().slice(0, 50)
        return title.length < content.trim().length ? `${title}...` : title
    }
}
