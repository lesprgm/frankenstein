export interface User {
  id: string
  email: string
  name: string
  created_at: string
  updated_at: string
}

export interface UserWithPassword extends User {
  password_hash: string
}

export interface Session {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  created_at: string
}

export interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  owner_id: string
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at: string
}

export interface JWTPayload {
  userId: string
  email: string
  iat: number
  exp: number
}

export interface SignupRequest {
  email: string
  password: string
  name: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  user: User
  token: string
  workspace?: Workspace
  workspaces?: Workspace[]
}
