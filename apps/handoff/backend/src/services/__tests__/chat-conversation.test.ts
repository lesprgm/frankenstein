import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatConversationService } from '../chat-conversation'
import { DatabaseClient } from '../../lib/db'

describe('ChatConversationService', () => {
    let service: ChatConversationService
    let mockDb: DatabaseClient

    beforeEach(() => {
        mockDb = {
            query: vi.fn()
        } as any
        service = new ChatConversationService(mockDb)
    })

    describe('createConversation', () => {
        it('should create a new conversation', async () => {
            const mockConversation = {
                id: 'conv1',
                workspace_id: 'ws1',
                title: 'Test Conversation',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }

            vi.mocked(mockDb.query).mockResolvedValue([mockConversation])

            const result = await service.createConversation('ws1', 'Test Conversation')

            expect(result).toEqual(mockConversation)
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO chat_conversations'),
                expect.arrayContaining(['ws1', 'Test Conversation'])
            )
        })

        it('should create conversation without title', async () => {
            const mockConversation = {
                id: 'conv1',
                workspace_id: 'ws1',
                title: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }

            vi.mocked(mockDb.query).mockResolvedValue([mockConversation])

            const result = await service.createConversation('ws1')

            expect(result.title).toBeNull()
        })
    })

    describe('saveMessage', () => {
        it('should save a user message', async () => {
            const mockMessage = {
                id: 'msg1',
                conversation_id: 'conv1',
                role: 'user' as const,
                content: 'Hello',
                sources: null,
                created_at: new Date().toISOString()
            }

            vi.mocked(mockDb.query).mockResolvedValue([mockMessage])

            const result = await service.saveMessage('conv1', 'user', 'Hello')

            expect(result).toEqual(mockMessage)
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO chat_messages'),
                expect.arrayContaining(['conv1', 'user', 'Hello'])
            )
        })

        it('should save assistant message with sources', async () => {
            const sources = ['mem1', 'mem2']
            const mockMessage = {
                id: 'msg1',
                conversation_id: 'conv1',
                role: 'assistant' as const,
                content: 'Response',
                sources: JSON.stringify(sources),
                created_at: new Date().toISOString()
            }

            vi.mocked(mockDb.query).mockResolvedValue([mockMessage])

            const result = await service.saveMessage('conv1', 'assistant', 'Response', sources)

            expect(result).toEqual(mockMessage)
        })
    })

    describe('getConversation', () => {
        it('should return conversation with messages', async () => {
            const mockConversation = {
                id: 'conv1',
                workspace_id: 'ws1',
                title: 'Test',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }

            const mockMessages = [
                {
                    id: 'msg1',
                    conversation_id: 'conv1',
                    role: 'user',
                    content: 'Hello',
                    sources: null,
                    created_at: new Date().toISOString()
                }
            ]

            vi.mocked(mockDb.query)
                .mockResolvedValueOnce([mockConversation])
                .mockResolvedValueOnce(mockMessages)

            const result = await service.getConversation('conv1', 'ws1')

            expect(result).toEqual({
                ...mockConversation,
                messages: mockMessages
            })
        })

        it('should return null for non-existent conversation', async () => {
            vi.mocked(mockDb.query).mockResolvedValue([])

            const result = await service.getConversation('nonexistent', 'ws1')

            expect(result).toBeNull()
        })
    })

    describe('listConversations', () => {
        it('should list conversations with pagination', async () => {
            const mockConversations = [
                {
                    id: 'conv1',
                    workspace_id: 'ws1',
                    title: 'Conversation 1',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ]

            vi.mocked(mockDb.query)
                .mockResolvedValueOnce([{ count: 1 }])
                .mockResolvedValueOnce(mockConversations)

            const result = await service.listConversations('ws1', { limit: 50, offset: 0 })

            expect(result).toEqual({
                conversations: mockConversations,
                total: 1
            })
        })
    })

    describe('updateConversationTitle', () => {
        it('should update title', async () => {
            const mockConversation = {
                id: 'conv1',
                workspace_id: 'ws1',
                title: 'New Title',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }

            vi.mocked(mockDb.query).mockResolvedValue([mockConversation])

            const result = await service.updateConversationTitle('conv1', 'ws1', 'New Title')

            expect(result).toEqual(mockConversation)
        })
    })

    describe('deleteConversation', () => {
        it('should delete conversation', async () => {
            vi.mocked(mockDb.query).mockResolvedValue([])

            const result = await service.deleteConversation('conv1', 'ws1')

            expect(result).toBe(true)
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM chat_conversations'),
                ['conv1', 'ws1']
            )
        })
    })

    describe('generateTitle', () => {
        it('should generate title from short content', async () => {
            const result = await service.generateTitle('Short message')

            expect(result).toBe('Short message')
        })

        it('should truncate long content', async () => {
            const longContent = 'a'.repeat(100)
            const result = await service.generateTitle(longContent)

            expect(result).toHaveLength(53) // 50 chars + '...'
            expect(result).toContain('...')
        })
    })
})
