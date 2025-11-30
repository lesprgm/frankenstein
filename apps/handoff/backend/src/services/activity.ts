import { DatabaseClient } from '../lib/db'

export interface Activity {
  id: string
  workspace_id: string
  user_id: string
  user_name: string
  type: 'import' | 'extraction' | 'chat' | 'member_added'
  details: Record<string, any>
  created_at: string
  message: string
}

export interface GetActivitiesOptions {
  workspaceId: string
  userId?: string
  limit?: number
  offset?: number
}

export interface GetActivitiesResult {
  activities: Activity[]
  total: number
}

export class ActivityService {
  private db: DatabaseClient

  constructor(db: DatabaseClient) {
    this.db = db
  }

  async logActivity(
    workspaceId: string,
    userId: string,
    type: Activity['type'],
    details: Record<string, any> = {}
  ): Promise<void> {
    await this.db.createActivity(workspaceId, userId, type, details)
  }

  async getActivities(options: GetActivitiesOptions): Promise<GetActivitiesResult> {
    const { workspaceId, userId, limit = 50, offset = 0 } = options

    // Build query with optional user filter
    let whereClause = 'WHERE a.workspace_id = $1'
    const params: any[] = [workspaceId]
    let paramIndex = 2

    if (userId) {
      whereClause += ` AND a.user_id = $${paramIndex}`
      params.push(userId)
      paramIndex++
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM activities a
      ${whereClause}
    `
    const countResult = await this.db.query<{ count: string }>(countQuery, params)
    const total = parseInt(countResult[0]?.count || '0', 10)

    // Get activities with user information
    const query = `
      SELECT 
        a.id,
        a.workspace_id,
        a.user_id,
        u.name as user_name,
        a.type,
        a.details,
        a.created_at
      FROM activities a
      JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `
    params.push(limit, offset)

    const activities = await this.db.query<Omit<Activity, 'message'>>(query, params)

    // Format activities with messages
    const formattedActivities = activities.map(activity => ({
      ...activity,
      message: this.formatActivityMessage(activity)
    }))

    return {
      activities: formattedActivities,
      total
    }
  }

  private formatActivityMessage(activity: Omit<Activity, 'message'>): string {
    const { type, user_name, details } = activity

    switch (type) {
      case 'import':
        const conversationCount = details.conversation_count || 0
        return `${user_name} imported ${conversationCount} conversation${conversationCount !== 1 ? 's' : ''}`

      case 'extraction':
        const memoryCount = details.memory_count || 0
        return `${user_name} extracted ${memoryCount} memor${memoryCount !== 1 ? 'ies' : 'y'}`

      case 'chat':
        const messageCount = details.message_count || 1
        return `${user_name} had a chat conversation (${messageCount} message${messageCount !== 1 ? 's' : ''})`

      case 'member_added':
        const memberName = details.member_name || 'a new member'
        return `${user_name} added ${memberName} to the workspace`

      default:
        return `${user_name} performed an action`
    }
  }
}
