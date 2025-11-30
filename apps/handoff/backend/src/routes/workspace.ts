import { Hono } from 'hono'
import { WorkspaceService } from '../services/workspace'
import { AuthService } from '../services/auth'
import { User } from '../types/auth'

interface CreateWorkspaceRequest {
  name: string
  type: 'personal' | 'team'
}

interface AddMemberRequest {
  email: string
}

type Variables = {
  user: User
}

export function createWorkspaceRoutes(workspaceService: WorkspaceService, authService: AuthService) {
  const workspace = new Hono<{ Variables: Variables }>()

  // Middleware to verify authentication
  const requireAuth = async (c: any, next: any) => {
    try {
      const authHeader = c.req.header('Authorization')

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const token = authHeader.substring(7)
      const user = await authService.getUserFromToken(token)

      // Store user in context
      c.set('user', user)

      await next()
    } catch (error) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  // GET /workspaces - Get all user's workspaces
  workspace.get('/', requireAuth, async (c) => {
    try {
      const user = c.get('user')
      const workspaces = await workspaceService.getUserWorkspaces(user.id)

      return c.json({ workspaces }, 200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch workspaces'
      return c.json({ error: message }, 500)
    }
  })

  // POST /workspaces - Create a new workspace
  workspace.post('/', requireAuth, async (c) => {
    try {
      const user = c.get('user')
      const { name } = await c.req.json<{ name: string }>();
      const userId = user.id;

      if (!name || name.trim() === '') {
        return c.json({ error: 'Workspace name is required' }, 400);
      }

      // Hardcoded to personal workspace for hackathon
      const workspace = await workspaceService.createWorkspace(userId, name, 'personal');

      return c.json({ workspace }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create workspace'
      return c.json({ error: message }, 400)
    }
  })

  // POST /workspaces/:id/members - Add a member to a workspace
  workspace.post('/:id/members', requireAuth, async (c) => {
    try {
      const user = c.get('user')
      const workspaceId = c.req.param('id')
      const body = await c.req.json<AddMemberRequest>()
      const { email } = body

      // Validate input
      if (!email) {
        return c.json({ error: 'Email is required' }, 400)
      }

      // Add member
      const member = await workspaceService.addMember(workspaceId, email, user.id)

      return c.json({ member }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add member'
      const status = message.includes('not found') ? 404 :
        message.includes('access') ? 403 : 400
      return c.json({ error: message }, status)
    }
  })

  return workspace
}
