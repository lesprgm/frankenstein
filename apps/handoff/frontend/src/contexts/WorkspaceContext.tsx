import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { api, Workspace } from '../lib/api'
import { useAuth } from './AuthContext'

interface WorkspaceContextValue {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  isLoading: boolean
  isSwitching: boolean
  switchWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string, type: 'personal' | 'team') => Promise<Workspace>
  addMember: (workspaceId: string, email: string) => Promise<void>
  refreshWorkspaces: () => Promise<void>
  deleteWorkspace: (workspaceId: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

// Cache configuration
const CACHE_KEY = 'workspaces_cache'
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

interface CachedData {
  workspaces: Workspace[]
  timestamp: number
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSwitching, setIsSwitching] = useState(false)

  // Load from cache
  const loadFromCache = useCallback((): Workspace[] | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (!cached) return null

      const data: CachedData = JSON.parse(cached)
      const age = Date.now() - data.timestamp

      if (age < CACHE_DURATION) {
        return data.workspaces
      }

      // Cache expired
      localStorage.removeItem(CACHE_KEY)
      return null
    } catch {
      return null
    }
  }, [])

  // Save to cache
  const saveToCache = useCallback((workspaces: Workspace[]) => {
    try {
      const data: CachedData = {
        workspaces,
        timestamp: Date.now(),
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to cache workspaces:', error)
    }
  }, [])

  // Load workspaces when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadWorkspaces()
    } else {
      setWorkspaces([])
      setCurrentWorkspace(null)
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const loadWorkspaces = async (skipCache = false) => {
    try {
      setIsLoading(true)

      // Try cache first
      if (!skipCache) {
        const cached = loadFromCache()
        if (cached) {
          setWorkspaces(cached)

          // Restore current workspace
          const savedWorkspaceId = localStorage.getItem('current_workspace_id')
          if (savedWorkspaceId) {
            const savedWorkspace = cached.find(w => w.id === savedWorkspaceId)
            if (savedWorkspace) {
              setCurrentWorkspace(savedWorkspace)
              setIsLoading(false)

              // Fetch fresh data in background
              loadWorkspaces(true)
              return
            }
          }

          // Set first workspace as current
          if (cached.length > 0) {
            setCurrentWorkspace(cached[0])
            localStorage.setItem('current_workspace_id', cached[0].id)
          }

          setIsLoading(false)

          // Fetch fresh data in background
          loadWorkspaces(true)
          return
        }
      }

      // Fetch from API
      const { workspaces: fetchedWorkspaces } = await api.getWorkspaces()
      setWorkspaces(fetchedWorkspaces)
      saveToCache(fetchedWorkspaces)

      // Try to restore saved workspace from localStorage
      const savedWorkspaceId = localStorage.getItem('current_workspace_id')
      if (savedWorkspaceId) {
        const savedWorkspace = fetchedWorkspaces.find(w => w.id === savedWorkspaceId)
        if (savedWorkspace) {
          setCurrentWorkspace(savedWorkspace)
          return
        }
      }

      // Otherwise, set first workspace as current
      if (fetchedWorkspaces.length > 0) {
        setCurrentWorkspace(fetchedWorkspaces[0])
        localStorage.setItem('current_workspace_id', fetchedWorkspaces[0].id)
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const switchWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (workspace) {
      setIsSwitching(true)
      setCurrentWorkspace(workspace)
      localStorage.setItem('current_workspace_id', workspace.id)

      // Reset switching state after a brief delay
      setTimeout(() => setIsSwitching(false), 300)
    }
  }

  const createWorkspace = async (name: string, type: 'personal' | 'team'): Promise<Workspace> => {
    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticWorkspace: Workspace = {
      id: tempId,
      name,
      type,
      owner_id: '',
      created_at: now,
      updated_at: now,
    }

    setWorkspaces(prev => [...prev, optimisticWorkspace])
    setCurrentWorkspace(optimisticWorkspace)
    localStorage.setItem('current_workspace_id', tempId)

    try {
      const { workspace } = await api.createWorkspace({ name, type })

      // Replace optimistic workspace with real one
      setWorkspaces(prev => prev.map(w => w.id === tempId ? workspace : w))
      setCurrentWorkspace(workspace)
      localStorage.setItem('current_workspace_id', workspace.id)

      // Update cache
      const updatedWorkspaces = workspaces.filter(w => w.id !== tempId).concat(workspace)
      saveToCache(updatedWorkspaces)

      return workspace
    } catch (error) {
      // Rollback optimistic update
      setWorkspaces(prev => prev.filter(w => w.id !== tempId))

      // Restore previous workspace
      if (workspaces.length > 0) {
        setCurrentWorkspace(workspaces[0])
        localStorage.setItem('current_workspace_id', workspaces[0].id)
      } else {
        setCurrentWorkspace(null)
        localStorage.removeItem('current_workspace_id')
      }

      throw error
    }
  }

  const addMember = async (workspaceId: string, email: string): Promise<void> => {
    await api.addWorkspaceMember(workspaceId, { email })
    // Refresh workspace data (roles/members) after invite
    await loadWorkspaces(true)
  }

  const refreshWorkspaces = async () => {
    await loadWorkspaces(true) // Skip cache on manual refresh
  }

  const deleteWorkspace = async (workspaceId: string) => {
    // Optimistic update
    const workspaceToDelete = workspaces.find(w => w.id === workspaceId)
    setWorkspaces(prev => prev.filter(w => w.id !== workspaceId))

    // If deleted workspace was current, switch to another
    if (currentWorkspace?.id === workspaceId) {
      const remaining = workspaces.filter(w => w.id !== workspaceId)
      if (remaining.length > 0) {
        setCurrentWorkspace(remaining[0])
        localStorage.setItem('current_workspace_id', remaining[0].id)
      } else {
        // No workspaces left - will create a new one after deletion completes
        setCurrentWorkspace(null)
        localStorage.removeItem('current_workspace_id')
      }
    }

    try {
      await api.deleteWorkspace(workspaceId)

      // Update cache
      const updatedWorkspaces = workspaces.filter(w => w.id !== workspaceId)
      saveToCache(updatedWorkspaces)

      // If no workspaces left, create a new personal workspace
      if (updatedWorkspaces.length === 0) {
        await createWorkspace('My Memory', 'personal')
      }
    } catch (error) {
      // Rollback on error
      if (workspaceToDelete) {
        setWorkspaces(prev => [...prev, workspaceToDelete])

        if (currentWorkspace?.id === workspaceId) {
          setCurrentWorkspace(workspaceToDelete)
          localStorage.setItem('current_workspace_id', workspaceId)
        }
      }

      throw error
    }
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        isLoading,
        isSwitching,
        switchWorkspace,
        createWorkspace,
        addMember,
        refreshWorkspaces,
        deleteWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
