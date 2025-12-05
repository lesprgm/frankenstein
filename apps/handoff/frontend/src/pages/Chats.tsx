import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../contexts/WorkspaceContext'
import Layout from '../components/layout/Layout'
import { api } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import LoadingSkeleton from '../components/LoadingSkeleton'
import ConversationModal from '../components/ConversationModal'

const HIDDEN_STORAGE_PREFIX = 'handoff_hidden_conversations_'

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
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string>>(new Set())
  const [deletingGroupKey, setDeletingGroupKey] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)

  const conversationIdParam = searchParams.get('id')
  const providerParam = searchParams.get('provider') || ''

  // Check for deep link
  useEffect(() => {
    if (conversationIdParam) {
      setSelectedConversationIds([conversationIdParam])
      setIsModalOpen(true)
    }
  }, [conversationIdParam])

  // Filters
  const [provider, setProvider] = useState<string>(() => providerParam)
  const [searchInput, setSearchInput] = useState<string>('')
  const debouncedSearch = useDebounce(searchInput, 500)

  // Load hidden groups per workspace
  useEffect(() => {
    if (!currentWorkspace?.id) return
    try {
      const stored = localStorage.getItem(`${HIDDEN_STORAGE_PREFIX}${currentWorkspace.id}`)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        setHiddenGroupIds(new Set(parsed))
      } else {
        setHiddenGroupIds(new Set())
      }
    } catch {
      setHiddenGroupIds(new Set())
    }
  }, [currentWorkspace?.id])

  const persistHidden = useCallback((nextHidden: Set<string>) => {
    if (!currentWorkspace?.id) return
    try {
      localStorage.setItem(
        `${HIDDEN_STORAGE_PREFIX}${currentWorkspace.id}`,
        JSON.stringify(Array.from(nextHidden))
      )
    } catch {
      // Ignore storage issues
    }
  }, [currentWorkspace?.id])

  // Sync provider filter from URL changes (no persistence)
  useEffect(() => {
    setProvider(providerParam)
  }, [providerParam])

  // Pagination
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const limit = 50

  // Fetch grouped conversations
  const fetchGroups = useCallback(async (reset = false) => {
    if (!currentWorkspace) return

    const sortGroupsByPriority = (items: ConversationGroup[]) => {
      const providerRank = (providers: string[]) => {
        const hasOpenAI = providers.some(p => {
          const lower = p.toLowerCase()
          return lower.includes('openai') || lower.includes('gpt')
        })
        return hasOpenAI ? 0 : 1
      }

      return [...items].sort((a, b) => {
        const providerDiff = providerRank(a.providers) - providerRank(b.providers)
        if (providerDiff !== 0) return providerDiff
        return new Date(b.last_active).getTime() - new Date(a.last_active).getTime()
      })
    }

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
        setGroups(sortGroupsByPriority(result.groups))
      } else {
        setGroups(prev => sortGroupsByPriority([...prev, ...result.groups]))
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
    handleProviderChange('')
  }

  const openConversationGroup = (ids: string[]) => {
    setSelectedConversationIds(ids)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedConversationIds([])
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('id')
      return next
    })
  }

  const getGroupKey = (conversationIds: string[]) => conversationIds.sort().join('|')

  const visibleGroups = groups.filter(group => !hiddenGroupIds.has(getGroupKey(group.conversation_ids)))

  const hideGroup = (conversationIds: string[]) => {
    const key = getGroupKey(conversationIds)
    setHiddenGroupIds(prev => {
      const next = new Set(prev)
      next.add(key)
      persistHidden(next)
      return next
    })
  }

  const deleteGroup = async (conversationIds: string[]) => {
    if (!currentWorkspace) return
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return

    const key = getGroupKey(conversationIds)
    setDeletingGroupKey(key)

    try {
      // Soft-delete locally (API delete for grouped conversations not available)
      setGroups(prev => prev.filter(g => !g.conversation_ids.some(id => conversationIds.includes(id))))
      setHiddenGroupIds(prev => {
        const next = new Set(prev)
        next.add(key)
        persistHidden(next)
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete conversation'
      alert(message)
    } finally {
      setDeletingGroupKey(null)
    }
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
              <label htmlFor="provider-filter" className="sr-only">Filter by Provider</label>
              <div className="relative">
                <select
                  id="provider-filter"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full pl-4 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                >
                  <option value="">All Providers</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
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
            Showing {visibleGroups.length} conversation groups (from {total} total)
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
        {!isLoading && visibleGroups.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900">No conversations yet</h3>
            <p className="mt-2 text-gray-600 max-w-md mx-auto">
              {debouncedSearch || provider
                ? 'Try adjusting your filters to see more results.'
                : 'Import your chat history from ChatGPT or Claude to start building your external brain.'}
            </p>

            {!debouncedSearch && !provider && (
              <div className="mt-6">
                <a
                  href="/sources"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import Conversations
                </a>
              </div>
            )}
          </div>
        )}

        {/* Table View */}
        {!isLoading && visibleGroups.length > 0 && (
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
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {visibleGroups.map((group, idx) => (
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
                        {group.providers.map(p => {
                          const lower = p.toLowerCase()
                          const isOpenAI = lower.includes('openai') || lower.includes('gpt')
                          const isAnthropic = lower.includes('anthropic') || lower.includes('claude')
                          const isGemini = lower.includes('google') || lower.includes('gemini')

                          let badgeClass = 'bg-gray-100 text-gray-800 border-gray-200'

                          if (isOpenAI) {
                            badgeClass = 'bg-green-100 text-green-800 border-green-200'
                          } else if (isAnthropic) {
                            badgeClass = 'bg-orange-100 text-orange-800 border-orange-200'
                          } else if (isGemini) {
                            badgeClass = 'bg-blue-100 text-blue-800 border-blue-200'
                          }

                          return (
                            <span key={p} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeClass}`}>
                              {p}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            hideGroup(group.conversation_ids)
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded"
                        >
                          Hide
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteGroup(group.conversation_ids)
                          }}
                          disabled={deletingGroupKey === getGroupKey(group.conversation_ids)}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 border border-red-200 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {deletingGroupKey === getGroupKey(group.conversation_ids) ? 'Deleting…' : 'Delete'}
                        </button>
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
        {!isLoading && !isLoadingMore && visibleGroups.length > 0 && !hasMore && (
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
