import { Context, Next } from 'hono'
import { AuthService } from '../services/auth'
import { User } from '../types/auth'

export interface AuthContext {
  user: User
}

export function createAuthMiddleware(authService: AuthService) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.substring(7)

    try {
      const user = await authService.getUserFromToken(token)
      c.set('user', user)
      await next()
    } catch (error) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
}
