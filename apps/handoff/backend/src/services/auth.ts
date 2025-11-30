import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { DatabaseClient } from '../lib/db'
import { User, JWTPayload, Workspace } from '../types/auth'

export interface SignupResult {
  user: User
  token: string
  workspace: Workspace
}

export interface LoginResult {
  user: User
  token: string
  workspaces: Workspace[]
}

export class AuthService {
  private db: DatabaseClient
  private jwtSecret: string

  constructor(db: DatabaseClient, jwtSecret: string) {
    this.db = db
    this.jwtSecret = jwtSecret
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }

  generateToken(userId: string, email: string): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId,
      email
    }

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: '7d'
    })
  }

  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload
      return decoded
    } catch (error) {
      throw new Error('Invalid or expired token')
    }
  }

  async signup(email: string, password: string, name: string): Promise<SignupResult> {
    // Check if user already exists
    const existingUser = await this.db.getUserByEmail(email)
    if (existingUser) {
      throw new Error('User with this email already exists')
    }

    // Hash password
    const passwordHash = await this.hashPassword(password)

    // Create user
    const user = await this.db.createUser(email, passwordHash, name)

    // Create personal workspace
    const workspaceName = `${name}'s Memory`
    const workspace = await this.db.createWorkspace(workspaceName, 'personal', user.id)

    // Add user as workspace member
    await this.db.addWorkspaceMember(workspace.id, user.id, 'owner')

    // Generate token
    const token = this.generateToken(user.id, user.email)

    return {
      user,
      token,
      workspace
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    // Get user by email
    const userWithPassword = await this.db.getUserByEmail(email)
    if (!userWithPassword) {
      throw new Error('Invalid email or password')
    }

    // Verify password
    const isValidPassword = await this.comparePassword(password, userWithPassword.password_hash)
    if (!isValidPassword) {
      throw new Error('Invalid email or password')
    }

    // Get user workspaces
    const workspaces = await this.db.getUserWorkspaces(userWithPassword.id)

    // Generate token
    const token = this.generateToken(userWithPassword.id, userWithPassword.email)

    // Remove password_hash from response
    const { password_hash, ...user } = userWithPassword

    return {
      user,
      token,
      workspaces
    }
  }

  async getUserFromToken(token: string): Promise<User> {
    const payload = await this.verifyToken(token)
    const user = await this.db.getUserById(payload.userId)
    
    if (!user) {
      throw new Error('User not found')
    }

    return user
  }
}
