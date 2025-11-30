import { Hono } from 'hono'
import { AuthService } from '../services/auth'
import { SignupRequest, LoginRequest } from '../types/auth'

export function createAuthRoutes(authService: AuthService) {
  const auth = new Hono()

  // POST /auth/signup
  auth.post('/signup', async (c) => {
    try {
      const body = await c.req.json<SignupRequest>()
      const { email, password, name } = body

      // Validate input
      if (!email || !password || !name) {
        return c.json({ error: 'Email, password, and name are required' }, 400)
      }

      if (password.length < 8) {
        return c.json({ error: 'Password must be at least 8 characters' }, 400)
      }

      // Signup
      const result = await authService.signup(email, password, name)

      return c.json(result, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Signup failed'
      return c.json({ error: message }, 400)
    }
  })

  // POST /auth/login
  auth.post('/login', async (c) => {
    try {
      const body = await c.req.json<LoginRequest>()
      const { email, password } = body

      // Validate input
      if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400)
      }

      // Login
      const result = await authService.login(email, password)

      return c.json(result, 200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      return c.json({ error: message }, 401)
    }
  })

  // GET /auth/me (verify token and get current user)
  auth.get('/me', async (c) => {
    try {
      const authHeader = c.req.header('Authorization')
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const token = authHeader.substring(7)
      const user = await authService.getUserFromToken(token)

      return c.json({ user }, 200)
    } catch (error) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  })

  return auth
}
