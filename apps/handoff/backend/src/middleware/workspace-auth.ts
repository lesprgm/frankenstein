import { Context, Next } from 'hono'
import { AuthService } from '../services/auth'
import { User } from '../types/auth'

export function createAuthMiddleware(authService: AuthService) {
  return async (c: Context, next: Next) => {
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
}

// Type helper for routes that use auth middleware
export interface AuthContext {
  user: User
}
