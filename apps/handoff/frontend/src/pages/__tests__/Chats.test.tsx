import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Chats from '../Chats'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../contexts/AuthContext'
import { WorkspaceProvider } from '../../contexts/WorkspaceContext'
import * as apiModule from '../../lib/api'

// Mock data
const mockConversations = [
  {
    id: '1',
    workspace_id: 'ws1',
    provider: 'openai',
    external_id: 'ext1',
    title: 'Test Conversation 1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    raw_metadata: {},
    user_id: 'user1',
    user_name: 'Test User',
    message_count: 5,
    memory_count: 3,
  },
  {
    id: '2',
    workspace_id: 'ws1',
    provider: 'anthropic',
    external_id: 'ext2',
    title: 'Test Conversation 2',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    raw_metadata: {},
    user_id: 'user1',
    user_name: 'Test User',
    message_count: 10,
    memory_count: 7,
  },
]

// Mock contexts
vi.mock('../../contexts/WorkspaceContext', async () => {
  const actual = await vi.importActual('../../contexts/WorkspaceContext')
  return {
    ...actual,
    useWorkspace: () => ({
      currentWorkspace: {
        id: 'ws1',
        name: 'Test Workspace',
        type: 'personal',
        owner_id: 'user1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      workspaces: [],
      isLoading: false,
      isSwitching: false,
      switchWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      addMember: vi.fn(),
      refreshWorkspaces: vi.fn(),
      deleteWorkspace: vi.fn(),
    }),
  }
})

vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual('../../contexts/AuthContext')
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: true,
      user: { id: 'user1', email: 'test@example.com', name: 'Test User' },
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    }),
  }
})

// Mock API
vi.mock('../../lib/api', () => ({
  api: {
    getGroupedConversations: vi.fn(),
  },
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const renderWithRouter = (component: React.ReactElement) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <WorkspaceProvider>
            {component}
          </WorkspaceProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Chats (ConversationsList)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock IntersectionObserver
    const mockIntersectionObserver = vi.fn()
    mockIntersectionObserver.mockReturnValue({
      observe: () => null,
      unobserve: () => null,
      disconnect: () => null
    })
    window.IntersectionObserver = mockIntersectionObserver

    vi.mocked(apiModule.api.getGroupedConversations).mockResolvedValue({
      groups: mockConversations.map(c => ({
        title: c.title,
        title_normalized: c.title.toLowerCase(),
        conversation_ids: [c.id],
        segment_count: 1,
        total_messages: c.message_count,
        total_memories: c.memory_count,
        last_active: c.updated_at,
        providers: [c.provider]
      })),
      total: 2,
    })
  })

  it('displays conversations list', async () => {
    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText('Test Conversation 1')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows conversation metadata', async () => {
    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText(/5 messages/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('orders conversations from most recent to oldest', async () => {
    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText('Test Conversation 1')).toBeInTheDocument()
    }, { timeout: 3000 })

    const titles = screen.getAllByText(/Test Conversation \d/)
    // OpenAI conversations should be listed first even if older
    expect(titles[0]).toHaveTextContent('Test Conversation 1')
    expect(titles[1]).toHaveTextContent('Test Conversation 2')
  })

  it('filters by provider', async () => {
    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText('Test Conversation 1')).toBeInTheDocument()
    }, { timeout: 3000 })

    const providerSelect = screen.getByLabelText('Filter by provider')
    fireEvent.change(providerSelect, { target: { value: 'openai' } })

    await waitFor(() => {
      expect(apiModule.api.getGroupedConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
        })
      )
    }, { timeout: 3000 })
  })

  it('searches conversations', async () => {
    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText('Test Conversation 1')).toBeInTheDocument()
    }, { timeout: 3000 })

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    expect(searchInput).toBeInTheDocument()
  })

  it('shows empty state when no conversations', async () => {
    vi.mocked(apiModule.api.getGroupedConversations).mockResolvedValue({
      groups: [],
      total: 0,
    })

    renderWithRouter(<Chats />)

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
