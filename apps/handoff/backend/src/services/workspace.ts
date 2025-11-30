import { DatabaseClient } from '../lib/db'
import { Workspace, WorkspaceMember } from '../types/auth'

export class WorkspaceService {
  private db: DatabaseClient
  private logActivity?: (workspaceId: string, userId: string, type: string, details: Record<string, any>) => Promise<void>

  constructor(db: DatabaseClient, logActivity?: (workspaceId: string, userId: string, type: string, details: Record<string, any>) => Promise<void>) {
    this.db = db
    this.logActivity = logActivity
  }

  async createWorkspace(userId: string, name: string, type: 'personal' | 'team'): Promise<Workspace> {
    // Create workspace
    const workspace = await this.db.createWorkspace(name, type, userId)

    // Add creator as owner
    await this.db.addWorkspaceMember(workspace.id, userId, 'owner')

    return workspace
  }

  async getUserWorkspaces(userId: string): Promise<Workspace[]> {
    return this.db.getUserWorkspaces(userId)
  }

  async addMember(workspaceId: string, email: string, requestingUserId: string): Promise<WorkspaceMember> {
    // Check if requesting user is the owner (only owners can invite)
    const workspace = await this.db.getWorkspaceById(workspaceId)
    if (!workspace) {
      throw new Error('Workspace not found')
    }
    if (workspace.owner_id !== requestingUserId) {
      throw new Error('You do not have access to this workspace')
    }

    // Get user by email
    const user = await this.db.getUserByEmail(email)
    if (!user) {
      throw new Error('User not found')
    }

    // Check if user is already a member
    const isAlreadyMember = await this.isMember(workspaceId, user.id)
    if (isAlreadyMember) {
      throw new Error('User is already a member of this workspace')
    }

    // Add user as member
    const member = await this.db.addWorkspaceMember(workspaceId, user.id, 'member')

    // Log member_added activity
    if (this.logActivity) {
      try {
        await this.logActivity(workspaceId, requestingUserId, 'member_added', {
          member_name: user.name
        })
      } catch (error) {
        console.error('Failed to log member_added activity:', error)
      }
    }

    return member
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    return this.db.isWorkspaceMember(workspaceId, userId)
  }

  async getWorkspaceMembers(workspaceId: string): Promise<Array<{ id: string; user_id: string; name: string; email: string; role: string; created_at: string }>> {
    return this.db.getWorkspaceMembers(workspaceId)
  }

  async deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
    // Check if user is the owner of the workspace
    const workspace = await this.db.getWorkspaceById(workspaceId)
    if (!workspace) {
      throw new Error('Workspace not found')
    }

    if (workspace.owner_id !== userId) {
      throw new Error('Only the workspace owner can delete the workspace')
    }

    // Delete all workspace data
    await this.db.deleteWorkspaceData(workspaceId)
  }
}
