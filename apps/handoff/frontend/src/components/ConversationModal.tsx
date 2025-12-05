import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { api, type Memory, type Message } from '../lib/api'

interface MergedConversation {
    title: string
    created_at: string
    messages: Message[]
}

interface ConversationModalProps {
    conversationIds: string[]
    isOpen: boolean
    onClose: () => void
}

export default function ConversationModal({ conversationIds, isOpen, onClose }: ConversationModalProps) {
    const { currentWorkspace } = useWorkspace()
    const [conversation, setConversation] = useState<MergedConversation | null>(null)
    const [extractedMemories, setExtractedMemories] = useState<Memory[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [loadingProgress, setLoadingProgress] = useState<string>('')
    const [isExporting, setIsExporting] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [copyContextLabel, setCopyContextLabel] = useState('Copy Context')
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})

    useEffect(() => {
        if (isOpen && conversationIds.length > 0 && currentWorkspace) {
            loadConversation()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, conversationIds, currentWorkspace])

    const loadConversation = async () => {
        if (!currentWorkspace || conversationIds.length === 0) return
        setIsLoading(true)
        setLoadingProgress(`Loading ${conversationIds.length} segment${conversationIds.length > 1 ? 's' : ''}...`)

        try {
            // Use batch fetch endpoint
            const result = await api.getBatchConversations(conversationIds, currentWorkspace.id)

            // Merge messages
            let allMessages: Message[] = []
            let allMemories: Memory[] = []
            let title = 'Untitled Conversation'
            let createdAt = new Date().toISOString()

            result.conversations.forEach((res, idx) => {
                if (idx === 0) {
                    title = res.conversation.title || 'Untitled Conversation'
                    createdAt = res.conversation.created_at
                }
                allMessages = [...allMessages, ...res.messages]
                allMemories = [...allMemories, ...res.memories]
            })

            // Two-stage deduplication:
            // 1. First deduplicate by ID (same message appearing multiple times)
            const uniqueById = Array.from(new Map(allMessages.map(m => [m.id, m])).values())

            // 2. Then deduplicate by content hash (duplicate messages with different IDs)
            // This catches cases where the same message was imported multiple times with different IDs
            const uniqueMessages = Array.from(
                new Map(
                    uniqueById.map(m => {
                        // Create a hash from role, content, and timestamp (rounded to nearest minute)
                        const timestamp = new Date(m.created_at).toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
                        const hash = `${m.role}:${m.content.substring(0, 500)}:${timestamp}`
                        return [hash, m]
                    })
                ).values()
            )

            // Sort messages by date
            uniqueMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

            // Deduplicate memories by ID
            const uniqueMemories = Array.from(new Map(allMemories.map(m => [m.id, m])).values())

            setConversation({
                title,
                created_at: createdAt,
                messages: uniqueMessages
            })
            setExtractedMemories(uniqueMemories)

        } catch (err) {
            console.error('Failed to load conversation', err)
        } finally {
            setIsLoading(false)
            setLoadingProgress('')
        }
    }

    const handleExport = async () => {
        if (!currentWorkspace || conversationIds.length === 0) return
        setIsExporting(true)
        try {
            // Build a comprehensive export with all messages from merged conversations
            if (!conversation) return

            const markdown = [
                `# ${conversation.title}`,
                '',
                `**Date:** ${new Date(conversation.created_at).toLocaleString()}`,
                `**Segments:** ${conversationIds.length}`,
                `**Total Messages:** ${conversation.messages.length}`,
                '',
                '---',
                '',
                '## Transcript',
                ''
            ]

            conversation.messages.forEach((msg, idx) => {
                const role = msg.role === 'assistant' ? '**Assistant**' : '**User**'
                const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                markdown.push(`### ${idx + 1}. ${role} (${time})`)
                markdown.push('')
                markdown.push(msg.content)
                markdown.push('')
            })

            if (extractedMemories.length > 0) {
                markdown.push('---', '', '## Extracted Memories', '')
                extractedMemories.forEach((mem, idx) => {
                    markdown.push(`${idx + 1}. **[${mem.type}]** ${mem.content} _(${Math.round(mem.confidence * 100)}% confidence)_`)
                })
            }

            const content = markdown.join('\n')
            const blob = new Blob([content], { type: 'text/markdown' })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${conversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
            document.body.removeChild(a)
        } catch (err) {
            console.error('Failed to export', err)
            alert('Failed to export conversation')
        } finally {
            setIsExporting(false)
        }
    }

    const scrollToMessage = (messageId: string) => {
        const el = messageRefs.current[messageId]
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('bg-yellow-100')
            setTimeout(() => el.classList.remove('bg-yellow-100'), 2000)
        }
    }

    const handleMemoryClick = (memory: Memory) => {
        const sourceMessageId = memory.metadata?.source_message_id as string
        if (sourceMessageId) {
            scrollToMessage(sourceMessageId)
            return
        }

        // Fallback: Try to find by timestamp proximity
        if (!conversation) return
        const memoryTime = new Date(memory.created_at).getTime()
        const closestMessage = conversation.messages.reduce((closest, msg) => {
            const msgTime = new Date(msg.created_at).getTime()
            const closestTime = new Date(closest.created_at).getTime()
            return Math.abs(msgTime - memoryTime) < Math.abs(closestTime - memoryTime) ? msg : closest
        })
        if (closestMessage) {
            scrollToMessage(closestMessage.id)
        }
    }

    // Filter messages by search
    const filteredMessages = conversation?.messages.filter(msg =>
        searchQuery === '' || msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    // Build a nuanced context block for copy
    const contextBlock = useMemo(() => {
        if (!conversation) return ''

        const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
        const slice = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text

        const messages = conversation.messages
        const lastUser = [...messages].reverse().find(m => m.role === 'user')
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')

        // Focused turns, not full dump
        const conciseTurns = messages.slice(-6).map(m => {
            const role = m.role === 'assistant' ? 'AI' : 'User'
            return `${role}: ${slice(clean(m.content), 160)}`
        })

        // Curate memories for nuance (top 5)
        const curatedFacts = extractedMemories.slice(0, 5).map(mem => {
            const confidence = mem.confidence ? `${Math.round(mem.confidence * 100)}%` : 'n/a'
            return `- ${mem.type}: ${slice(clean(mem.content), 200)} (conf: ${confidence})`
        })

        // If no memories, pull distilled insights from last assistant replies
        const fallbackInsights: string[] = []
        if (curatedFacts.length === 0) {
            const assistantMessages = messages.filter(m => m.role === 'assistant').slice(-3)
            assistantMessages.forEach((m, idx) => {
                fallbackInsights.push(`- Insight ${idx + 1}: ${slice(clean(m.content), 200)}`)
            })
        }

        const taskLine = lastUser ? slice(clean(lastUser.content), 180) : 'n/a'
        const outcomeLine = lastAssistant ? slice(clean(lastAssistant.content), 180) : null

        const block: string[] = [
            `Context for LLM — ${conversation.title}`,
            `Task/Ask: ${taskLine}`,
        ]

        if (outcomeLine) {
            block.push(`Latest AI: ${outcomeLine}`)
        }

        const insights = curatedFacts.length > 0 ? curatedFacts : fallbackInsights
        if (insights.length > 0) {
            block.push('', 'Key context (succinct):', ...insights)
        }

        if (conciseTurns.length > 0) {
            block.push('', 'Recent turns (trimmed):', ...conciseTurns)
        }

        return block.join('\n')
    }, [conversation, extractedMemories])

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
                </Transition.Child>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <Dialog.Panel className="w-full max-w-6xl transform overflow-hidden rounded-2xl bg-[var(--color-bg-primary)] shadow-2xl transition-all h-[85vh] flex flex-col">
                                {/* Header */}
                                <div className="flex flex-col border-b border-[var(--color-border-subtle)] px-8 py-6 flex-shrink-0 gap-4">
                                    {/* Breadcrumbs */}
                                    <nav className="flex items-center text-sm text-[var(--color-text-tertiary)]">
                                        <span className="hover:text-[var(--color-text-secondary)] cursor-pointer" onClick={onClose}>Chats</span>
                                        <svg className="w-4 h-4 mx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        <span className="font-medium text-[var(--color-text-primary)] truncate max-w-md">
                                            {conversation?.title || 'Loading...'}
                                        </span>
                                    </nav>

                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <Dialog.Title className="text-2xl font-bold text-[var(--color-text-primary)]">
                                                {conversation?.title || 'Loading...'}
                                            </Dialog.Title>
                                            {conversation && (
                                                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                                                    {conversationIds.length > 1 ? `${conversationIds.length} merged segments · ${conversation.messages.length} messages` : `${conversation.messages.length} messages · ${new Date(conversation.created_at).toLocaleDateString()}`}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={async () => {
                                                    if (!contextBlock) return
                                                    try {
                                                        await navigator.clipboard.writeText(contextBlock)
                                                        setCopyContextLabel('Copied!')
                                                    } catch {
                                                        setCopyContextLabel('Copy failed')
                                                    } finally {
                                                        setTimeout(() => setCopyContextLabel('Copy Context'), 2000)
                                                    }
                                                }}
                                                className="btn-ios-secondary text-sm flex items-center gap-2"
                                                disabled={!conversation}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17l4 4 4-4m-4-5v9" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 10V5a2 2 0 00-2-2H6a2 2 0 00-2 2v11a2 2 0 002 2h3" />
                                                </svg>
                                                {copyContextLabel}
                                            </button>
                                            <button
                                                onClick={handleExport}
                                                disabled={isExporting || !conversation}
                                                className="btn-ios-secondary text-sm"
                                            >
                                                {isExporting ? 'Exporting...' : 'Export'}
                                            </button>
                                            <button
                                                onClick={onClose}
                                                className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] transition-colors"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-hidden">
                                    {isLoading ? (
                                        <div className="flex flex-col justify-center items-center h-full gap-4">
                                            <div className="spinner h-8 w-8"></div>
                                            {loadingProgress && (
                                                <p className="text-sm text-[var(--color-text-secondary)]">{loadingProgress}</p>
                                            )}
                                        </div>
                                    ) : conversation ? (
                                        <div className="grid grid-cols-1 lg:grid-cols-3 h-full">
                                            {/* Transcript */}
                                            <div className="lg:col-span-2 overflow-y-auto p-8 border-r border-[var(--color-border-subtle)]">
                                                <div className="sticky top-0 bg-[var(--color-bg-primary)] py-2 z-10 mb-4">
                                                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                                                        Transcript
                                                    </h3>
                                                    {/* Search bar */}
                                                    <input
                                                        type="text"
                                                        value={searchQuery}
                                                        onChange={(e) => setSearchQuery(e.target.value)}
                                                        placeholder="Search messages..."
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    />
                                                </div>
                                                <div className="space-y-6">
                                                    {filteredMessages.length === 0 ? (
                                                        <p className="text-center text-[var(--color-text-secondary)] py-8">
                                                            No messages match your search
                                                        </p>
                                                    ) : (
                                                        filteredMessages.map((msg, idx) => {
                                                            const messageKey = msg.id || `msg-${idx}`
                                                            const isAssistant = msg.role === 'assistant'

                                                            return (
                                                                <div
                                                                    key={messageKey}
                                                                    ref={el => messageRefs.current[msg.id] = el}
                                                                    className={`flex gap-4 ${isAssistant ? 'bg-transparent' : 'flex-row-reverse'} transition-colors duration-500 rounded-lg p-2`}
                                                                >
                                                                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${isAssistant
                                                                        ? 'bg-[var(--color-accent-indigo)] text-white'
                                                                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
                                                                        }`}>
                                                                        {isAssistant ? 'AI' : 'U'}
                                                                    </div>
                                                                    <div className={`flex flex-col max-w-[85%] space-y-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                                                        <div className={`rounded-2xl px-5 py-3 text-sm leading-relaxed ${msg.role === 'user'
                                                                            ? 'bg-[var(--color-accent-blue)] text-white'
                                                                            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]'
                                                                            }`}>
                                                                            <ReactMarkdown
                                                                                remarkPlugins={[remarkGfm]}
                                                                                components={{
                                                                                    // Style markdown elements to match our design
                                                                                    p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                                                                                    strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                                                                                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                                                                                    code: ({ node, ...props }) => <code className="bg-black/10 px-1 py-0.5 rounded text-xs" {...props} />,
                                                                                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2" {...props} />,
                                                                                    ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2" {...props} />,
                                                                                    li: ({ node, ...props }) => <li className="ml-2" {...props} />,
                                                                                    h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2" {...props} />,
                                                                                    h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2" {...props} />,
                                                                                    h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1" {...props} />,
                                                                                }}
                                                                            >
                                                                                {msg.content}
                                                                            </ReactMarkdown>
                                                                        </div>
                                                                        {isAssistant && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={async () => {
                                                                                    try {
                                                                                        if (navigator.clipboard?.writeText) {
                                                                                            await navigator.clipboard.writeText(msg.content)
                                                                                        }
                                                                                        setCopiedMessageId(messageKey)
                                                                                    } catch (e) {
                                                                                        console.error('Copy failed', e)
                                                                                    } finally {
                                                                                        setTimeout(() => setCopiedMessageId(null), 1500)
                                                                                    }
                                                                                }}
                                                                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2"
                                                                            >
                                                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                                                </svg>
                                                                                {copiedMessageId === messageKey ? 'Copied' : 'Copy'}
                                                                            </button>
                                                                        )}
                                                                        <span className="text-xs text-[var(--color-text-tertiary)] px-2">
                                                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })
                                                    )}
                                                </div>
                                            </div>

                                            {/* Extracted Memories (Context Tabs) */}
                                            <div className="overflow-y-auto p-6 bg-[var(--color-bg-secondary)]">
                                                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4 sticky top-0 bg-[var(--color-bg-secondary)] py-2 z-10">
                                                    Context & Memories
                                                </h3>
                                                {extractedMemories.length === 0 ? (
                                                    <p className="text-sm text-[var(--color-text-secondary)] italic">
                                                        No memories extracted yet.
                                                    </p>
                                                ) : (
                                                    <div className="space-y-3">
                                                        {extractedMemories.map(memory => (
                                                            <div
                                                                key={memory.id}
                                                                onClick={() => handleMemoryClick(memory)}
                                                                className="p-3 rounded-lg bg-white border border-[var(--color-border-subtle)] hover:border-blue-400 cursor-pointer transition-all shadow-sm hover:shadow-md"
                                                            >
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <span className={`badge ${memory.type}`}>{memory.type}</span>
                                                                    <span className="text-xs text-[var(--color-text-tertiary)]">
                                                                        {(memory.confidence * 100).toFixed(0)}% conf
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm text-[var(--color-text-primary)] line-clamp-3">
                                                                    {memory.content}
                                                                </p>
                                                                {!!memory.metadata?.source_message_id && (
                                                                    <div className="mt-2 text-xs text-blue-600 flex items-center gap-1">
                                                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                                        </svg>
                                                                        Jump to context
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center text-[var(--color-text-secondary)]">
                                            Failed to load conversation
                                        </div>
                                    )}
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    )
}
