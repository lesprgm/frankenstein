import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { api } from '../lib/api'
import MemoryDetailModal from '../components/MemoryDetailModal'
import CreateMemoryModal from '../components/CreateMemoryModal'

interface Memory {
  id: string
  type: string
  content: string
  confidence: number
  metadata: Record<string, unknown>
  created_at: string
  conversation_id: string | null
}

export default function Context() {
  const { currentWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [memories, setMemories] = useState<Memory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  useEffect(() => {
    if (currentWorkspace) {
      loadMemories()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace])

  const loadMemories = async () => {
    if (!currentWorkspace) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await api.getMemories({
        workspaceId: currentWorkspace.id,
        limit: 100,
        type: filter === 'all' ? undefined : filter,
      })
      setMemories(result.memories)
    } catch (err) {
      setError('Failed to load memories')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateMemory = async (content: string, type: string) => {
    if (!currentWorkspace) return

    try {
      const result = await api.createMemory(currentWorkspace.id, {
        content,
        type,
        metadata: { source: 'manual' }
      })

      // Add new memory to list
      setMemories(prev => [result.memory, ...prev])
    } catch (err) {
      console.error('Failed to create memory', err)
      throw err
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'entity':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        )
      case 'fact':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'decision':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      default:
        return null
    }
  }

  const filteredMemories = memories.filter(memory => {
    if (memory.metadata.hidden) return false
    if (filter === 'all') return true
    if (filter === 'pinned') return memory.metadata.pinned
    return memory.type === filter
  })

  const togglePin = async (e: React.MouseEvent, memory: Memory) => {
    e.stopPropagation()
    if (!currentWorkspace) return

    try {
      // Optimistic update
      const updatedMemories = memories.map(m =>
        m.id === memory.id
          ? { ...m, metadata: { ...m.metadata, pinned: !m.metadata.pinned } }
          : m
      )
      setMemories(updatedMemories)

      await api.updateMemory(memory.id, currentWorkspace.id, {
        metadata: { ...memory.metadata, pinned: !memory.metadata.pinned }
      })
    } catch (err) {
      console.error('Failed to toggle pin', err)
      // Revert on error
      loadMemories()
    }
  }

  const hideMemory = async (e: React.MouseEvent, memory: Memory) => {
    e.stopPropagation()
    if (!currentWorkspace) return
    if (!window.confirm('Are you sure you want to hide this memory?')) return

    try {
      // Optimistic remove
      setMemories(prev => prev.filter(m => m.id !== memory.id))

      await api.updateMemory(memory.id, currentWorkspace.id, {
        metadata: { ...memory.metadata, hidden: true }
      })
    } catch (err) {
      console.error('Failed to hide memory', err)
    }
  }

  const startEditing = (e: React.MouseEvent, memory: Memory) => {
    e.stopPropagation()
    setEditingId(memory.id)
    setEditContent(memory.content)
  }

  const saveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentWorkspace || !editingId) return

    try {
      const memory = memories.find(m => m.id === editingId)
      if (!memory) return

      // Optimistic update
      setMemories(prev => prev.map(m =>
        m.id === editingId ? { ...m, content: editContent } : m
      ))
      setEditingId(null)

      await api.updateMemory(editingId, currentWorkspace.id, {
        content: editContent
      })
    } catch (err) {
      console.error('Failed to save edit', err)
      loadMemories()
    }
  }

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(null)
    setEditContent('')
  }

  const handleCardClick = (memory: Memory) => {
    // If memory has a conversation_id, navigate to it
    if (memory.conversation_id) {
      navigate(`/chats?id=${memory.conversation_id}`)
    }
  }

  const handleInfoClick = (e: React.MouseEvent, memory: Memory) => {
    e.stopPropagation()
    setSelectedMemory(memory)
    setIsDetailModalOpen(true)
  }

  return (
    <Layout>
      <PageHeader
        title="Context"
        subtitle="Your external brain. All the important details, facts, and decisions captured from your conversations."
        action={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn-ios-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Memory
          </button>
        }
      />

      <div className="space-y-6">
        {/* Filters - iOS Segmented Control Style */}
        <div className="flex items-center justify-between">
          <div className="pill-nav">
            {[
              { id: 'all', label: 'All' },
              { id: 'pinned', label: 'Pinned' },
              { id: 'entity', label: 'Entities' },
              { id: 'fact', label: 'Facts' },
              { id: 'decision', label: 'Decisions' }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={`pill-item ${filter === item.id ? 'active' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-bg-tertiary)] border-t-[var(--color-accent-blue)]"></div>
          </div>
        ) : error ? (
          <div className="text-center py-12 text-[var(--color-accent-red)]">
            {error}
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="text-center py-16 bg-[var(--color-bg-primary)] rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)]">
            <div className="w-16 h-16 mx-auto mb-4 bg-[var(--color-bg-tertiary)] rounded-full flex items-center justify-center text-[var(--color-text-tertiary)]">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-[var(--color-text-primary)]">No memories found</h3>
            <p className="text-[var(--color-text-secondary)] mt-1">Try adjusting your filters or create a new memory.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMemories.map((memory) => (
              <div
                key={memory.id}
                onClick={() => handleCardClick(memory)}
                className={`card-clean group relative ${memory.conversation_id ? 'cursor-pointer' : 'cursor-default'}`}
                title={memory.conversation_id ? 'Click to view source conversation' : 'No source conversation'}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`badge ${memory.type}`}>
                    <span className="mr-1.5">{getTypeIcon(memory.type)}</span>
                    {memory.type}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Info icon - opens detail modal */}
                    <button
                      onClick={(e) => handleInfoClick(e, memory)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                      title="View details"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => togglePin(e, memory)}
                      className={`p-1.5 rounded-full transition-colors ${memory.metadata.pinned
                        ? 'text-[var(--color-accent-orange)] bg-[var(--color-bg-tertiary)]'
                        : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                        }`}
                      title={memory.metadata.pinned ? "Unpin" : "Pin"}
                    >
                      <svg className={`w-4 h-4 ${memory.metadata.pinned ? 'fill-current' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => startEditing(e, memory)}
                      className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded-full transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => hideMemory(e, memory)}
                      className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-red)] hover:bg-[var(--color-bg-tertiary)] rounded-full transition-colors"
                      title="Hide"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    </button>
                  </div>
                </div>

                {editingId === memory.id ? (
                  <div className="space-y-3" onClick={e => e.stopPropagation()}>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="input-clean min-h-[100px] resize-none"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={cancelEdit} className="btn-ios-secondary text-xs py-1.5 px-3">Cancel</button>
                      <button onClick={saveEdit} className="btn-ios-primary text-xs py-1.5 px-3">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-[var(--color-text-primary)] text-base leading-relaxed">
                      {memory.content}
                    </p>
                    {memory.conversation_id && (
                      <div className="mt-3 text-xs text-blue-600 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        View source conversation
                      </div>
                    )}
                  </>
                )}

                <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between text-xs text-[var(--color-text-tertiary)]">
                  <span>{new Date(memory.created_at).toLocaleDateString()}</span>
                  {(memory.metadata.pinned as boolean) && (
                    <span className="flex items-center gap-1 text-[var(--color-accent-orange)] font-medium">
                      <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                      Pinned
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MemoryDetailModal
        memory={selectedMemory}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false)
          setSelectedMemory(null)
        }}
        onNavigateToSource={(conversationId) => {
          setIsDetailModalOpen(false)
          navigate(`/chats?id=${conversationId}`)
        }}
      />

      <CreateMemoryModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateMemory}
      />
    </Layout>
  )
}
