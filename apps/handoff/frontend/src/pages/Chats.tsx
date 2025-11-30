import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../contexts/WorkspaceContext'
import Layout from '../components/layout/Layout'
import { api } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import LoadingSkeleton from '../components/LoadingSkeleton'
import ConversationModal from '../components/ConversationModal'

interface ConversationGroup {
  title: string
  title_normalized: string
  conversation_ids: string[]
  segment_count: number
  total_messages: number
  total_memories: number
  last_active: string
  providers: string[]
}

export default function Chats() {
  const { currentWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const [groups, setGroups] = useState<ConversationGroup[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Check for deep link
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSelectedConversationIds([id])
      setIsModalOpen(true)
    }
  }, [searchParams])

  // Filters
  const [provider, setProvider] = useState<string>('')
  const [searchInput, setSearchInput] = useState<string>('')
  const debouncedSearch = useDebounce(searchInput, 500)

  // Pagination
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const limit = 50

  // Fetch grouped conversations
  const fetchGroups = useCallback(async (reset = false) => {
    if (!currentWorkspace) return

    const currentPage = reset ? 0 : page
    const isInitialLoad = currentPage === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsLoadingMore(true)
    }
    setError(null)

    try {
      const result = await api.getGroupedConversations({
        workspaceId: currentWorkspace.id,
        provider: provider || undefined,
        search: debouncedSearch || undefined,
        limit,
        offset: currentPage * limit
      })

      if (reset || isInitialLoad) {
        setGroups(result.groups)
      } else {
        setGroups(prev => [...prev, ...result.groups])
      }

      setTotal(result.total)
      setHasMore(result.groups.length === limit)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch conversations'
      setError(message)
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [currentWorkspace, provider, debouncedSearch, page, limit])

  // Initial load and filter changes
  useEffect(() => {
    setPage(0)
    setGroups([])
    fetchGroups(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace, provider, debouncedSearch])

  // Load more for infinite scroll
  const loadMore = useCallback(() => {
    if (!isLoading && !isLoadingMore && hasMore) {
      setPage(prev => prev + 1)
    }
  }, [isLoading, isLoadingMore, hasMore])

  // Trigger fetch when page changes
  useEffect(() => {
    if (page > 0) {
      fetchGroups()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Infinite scroll
  const { containerRef } = useInfiniteScroll(loadMore, {
    enabled: hasMore && !isLoading && !isLoadingMore,
  })

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
  }

  const handleClearSearch = () => {
    setSearchInput('')
  }

  const handleClearProvider = () => {
    setProvider('')
  }

  const openConversationGroup = (ids: string[]) => {
    setSelectedConversationIds(ids)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedConversationIds([])
    setSearchParams(params => {
      params.delete('id')
      return params
    })
  }

  return (
    <Layout>
      <div className="space-y-6" ref={containerRef} style={{ maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Chats</h1>
          <p className="mt-1 text-sm text-gray-600">
            Browse your imported conversations. Chats with the same title are merged automatically.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="md:w-48">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Providers</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
          </div>

          {(debouncedSearch || provider) && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-gray-600">Active filters:</span>
              {debouncedSearch && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full hover:bg-blue-200"
                >
                  Search: {debouncedSearch}
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              {provider && (
                <button
                  type="button"
                  onClick={handleClearProvider}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full hover:bg-blue-200"
                >
                  Provider: {provider}
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results count */}
        {!isLoading && (
          <div className="text-sm text-gray-600">
            Showing {groups.length} conversation groups (from {total} total)
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-4">
            <LoadingSkeleton type="card" count={3} />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && groups.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No conversations found</h3>
            <p className="mt-2 text-sm text-gray-600">
              {debouncedSearch || provider ? 'Try adjusting your filters' : 'Import some conversations to get started'}
            </p>
          </div>
        )}

        {/* Table View */}
        {!isLoading && groups.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Conversation
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Active
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stats
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {groups.map((group, idx) => (
                  <tr
                    key={`${group.title_normalized}-${idx}`}
                    onClick={() => openConversationGroup(group.conversation_ids)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {group.title}
                          </div>
                          {group.segment_count > 1 && (
                            <div className="text-xs text-blue-600 mt-0.5">
                              {group.segment_count} merged segments
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {new Date(group.last_active).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(group.last_active).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                          {group.total_messages} msgs
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          {group.total_memories} mems
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-1 flex-wrap">
                        {group.providers.map(p => (
                          <span key={p} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Loading more indicator */}
        {isLoadingMore && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-sm text-gray-600">Loading more conversations...</p>
          </div>
        )}

        {/* End of list indicator */}
        {!isLoading && !isLoadingMore && groups.length > 0 && !hasMore && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">You've reached the end of the list</p>
          </div>
        )}
      </div>

      <ConversationModal
        conversationIds={selectedConversationIds}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </Layout>
  )
}
