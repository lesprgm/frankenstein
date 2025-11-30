import { useState, useEffect, useRef } from 'react'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { api, Memory } from '../lib/api'
import { useChatConversations, useCreateChatConversation, useChatConversation } from '../hooks/useChatConversation'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: Memory[]
}

export default function Ask() {
  const { currentWorkspace } = useWorkspace()
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch conversations and current conversation
  const { data: conversationsData } = useChatConversations(currentWorkspace?.id || null)
  const { data: conversationData } = useChatConversation(currentConversationId, currentWorkspace?.id || null)
  const createConversation = useCreateChatConversation()

  // Load messages from current conversation
  useEffect(() => {
    if (conversationData?.conversation?.messages) {
      const loadedMessages: Message[] = conversationData.conversation.messages.map(msg => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: new Date(msg.created_at),
        sources: [] // Sources would be loaded separately if needed
      }))
      setMessages(loadedMessages)
    } else if (!currentConversationId) {
      setMessages([])
    }
  }, [conversationData, currentConversationId])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || !currentWorkspace) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMsg])
    const userQuery = query
    setQuery('')
    setIsTyping(true)

    try {
      // Create a new conversation if this is the first message
      let conversationId = currentConversationId
      if (!conversationId) {
        const newConv = await createConversation.mutateAsync({
          workspaceId: currentWorkspace.id,
          title: userQuery.slice(0, 50) // Use first 50 chars as title
        })
        conversationId = newConv.conversation.id
        setCurrentConversationId(conversationId)
      }

      // Call real API
      const response = await api.chat({
        message: userQuery,
        workspaceId: currentWorkspace.id,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      })

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        sources: response.sources
      }

      setMessages(prev => [...prev, assistantMsg])

      // Save both messages to conversation
      try {
        await api.chat({
          message: userQuery,
          workspaceId: currentWorkspace.id,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      } catch (saveErr) {
        console.error('Failed to save messages:', saveErr)
        // Don't block UX if save fails
      }
    } catch (err) {
      console.error('Failed to get response', err)

      // Add error message
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm sorry, I encountered an error while processing your request. Please try again.",
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsTyping(false)
    }
  }

  const handleNewConversation = () => {
    setCurrentConversationId(null)
    setMessages([])
  }

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-12rem)]">
        <div className="flex items-center justify-between mb-4">
          <PageHeader
            kicker="AI Assistant"
            title="Ask Anything"
            subtitle="Query your external brain using natural language."
            dense
          />

          {/* Conversation Selector */}
          <div className="flex items-center gap-2">
            {conversationsData?.conversations && conversationsData.conversations.length > 0 && (
              <select
                value={currentConversationId || ''}
                onChange={(e) => setCurrentConversationId(e.target.value || null)}
                className="px-4 py-2 bg-white border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-accent-blue)]"
              >
                <option value="">New conversation</option>
                {conversationsData.conversations.map((conv) => (
                  <option key={conv.id} value={conv.id}>
                    {conv.title || `Conversation ${conv.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={handleNewConversation}
              className="px-4 py-2 bg-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue-hover)] text-white rounded-lg text-sm font-medium transition-colors"
            >
              + New Chat
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 py-6 pr-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 opacity-50">
              <div className="w-20 h-20 bg-[var(--color-bg-tertiary)] rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div className="max-w-md">
                <h3 className="text-lg font-medium text-[var(--color-text-primary)]">No messages yet</h3>
                <p className="text-[var(--color-text-secondary)] mt-2">
                  Ask questions like "What did we decide about the database?" or "Who is working on the mobile app?"
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === 'assistant' ? 'bg-transparent' : 'flex-row-reverse'}`}
              >
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${msg.role === 'assistant'
                  ? 'bg-[var(--color-accent-indigo)] text-white'
                  : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
                  }`}>
                  {msg.role === 'assistant' ? 'AI' : 'You'}
                </div>

                {/* Message Bubble */}
                <div className={`flex flex-col max-w-[80%] space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-2xl px-5 py-3 text-[var(--text-base)] leading-relaxed shadow-sm ${msg.role === 'user'
                    ? 'bg-[var(--color-accent-blue)] text-white'
                    : 'bg-white border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]'
                    }`}>
                    {msg.content}
                  </div>

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="w-full space-y-2 mt-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] ml-1">
                        Sources
                      </p>
                      <div className="grid gap-2">
                        {msg.sources.map(source => (
                          <div key={source.id} className="card-clean p-3 text-sm hover:border-[var(--color-accent-blue)] cursor-pointer transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`badge ${source.type}`}>{source.type}</span>
                              <span className="text-[var(--color-text-tertiary)] text-xs">
                                {(source.confidence * 100).toFixed(0)}% match
                              </span>
                            </div>
                            <p className="text-[var(--color-text-secondary)] line-clamp-2">
                              {source.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-[var(--color-accent-indigo)] flex items-center justify-center text-white text-xs font-medium">
                AI
              </div>
              <div className="bg-white border border-[var(--color-border-subtle)] rounded-2xl px-5 py-4 shadow-sm flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="mt-4 relative">
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your memories..."
              className="w-full bg-white border border-[var(--color-border-subtle)] rounded-xl py-4 pl-5 pr-14 text-[var(--text-base)] shadow-sm focus:border-[var(--color-accent-blue)] focus:ring-2 focus:ring-[var(--color-accent-blue)] focus:ring-opacity-20 transition-all outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
            <button
              type="submit"
              disabled={!query.trim() || isTyping}
              className="absolute right-2 top-2 bottom-2 aspect-square bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent-blue)] text-[var(--color-text-secondary)] hover:text-white rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </Layout>
  )
}
