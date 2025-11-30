import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, User } from '../lib/api'

interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token')
        if (token) {
          const { user: currentUser } = await api.getCurrentUser()
          setUser(currentUser)
        }
      } catch (error) {
        // Token is invalid, clear it
        api.clearToken()
        localStorage.removeItem('current_workspace_id')
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [])

  const login = async (email: string, password: string) => {
    const response = await api.login({ email, password })
    setUser(response.user)
  }

  const signup = async (email: string, password: string, name: string) => {
    const response = await api.signup({ email, password, name })
    setUser(response.user)
  }

  const logout = () => {
    api.logout()
    setUser(null)
    localStorage.removeItem('current_workspace_id')
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
