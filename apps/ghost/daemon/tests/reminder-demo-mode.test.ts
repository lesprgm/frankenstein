import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/actions/action-executor';
import type { Action, MemoryReference } from '../src/types';

describe('ActionExecutor - Demo Mode Reminders', () => {
    let executor: ActionExecutor;
    let mockVoiceFeedback: any;
    let mockExplainabilityNotifier: any;
    let mockRemindersService: any;
    let mockApiClient: any;

    beforeEach(() => {
        mockVoiceFeedback = {
            provideFeedback: vi.fn().mockResolvedValue(undefined),
            getAcknowledgment: vi.fn().mockReturnValue('Noted.')
        };

        mockExplainabilityNotifier = {
            showContextNotification: vi.fn().mockResolvedValue(undefined)
        };

        mockRemindersService = {
            createReminder: vi.fn().mockResolvedValue({ success: true })
        };

        mockApiClient = {
            createMemory: vi.fn().mockResolvedValue({ ok: true, value: { id: 'test-memory-id' } })
        };

        executor = new ActionExecutor(
            mockVoiceFeedback,
            mockExplainabilityNotifier,
            mockRemindersService,
            mockApiClient
        );
    });

    describe('createReminder with screen context', () => {
        it('should store reminder with screenshot and file context', async () => {
            const action: Action = {
                type: 'reminder.create',
                params: {
                    title: 'Fix auth bug',
                    notes: 'Need to debug login flow'
                }
            };

            const context = {
                commandId: 'test-cmd-123',
                memories: [] as MemoryReference[],
                screenContext: {
                    text: 'Active file: /Users/test/auth.ts\nCode: function login() {...}',
                    screenshotPath: '/Users/test/.ghost/screenshots/test.png'
                }
            };

            const result = await executor.execute(action, context);

            expect(result.status).toBe('success');
            expect(mockRemindersService.createReminder).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Fix auth bug',
                    notes: expect.stringContaining('/Users/test/.ghost/screenshots/test.png')
                })
            );
            expect(mockApiClient.createMemory).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'reminder',
                    summary: expect.stringContaining('Fix auth bug'),
                    metadata: expect.objectContaining({
                        screenshot: '/Users/test/.ghost/screenshots/test.png',
                        context: expect.stringContaining('Active file: /Users/test/auth.ts')
                    })
                })
            );
        });

        it('should work without screen context', async () => {
            const action: Action = {
                type: 'reminder.create',
                params: {
                    title: 'Simple reminder'
                }
            };

            const result = await executor.execute(action, {
                commandId: 'test-cmd',
                memories: []
            });

            expect(result.status).toBe('success');
            expect(mockRemindersService.createReminder).toHaveBeenCalled();
            expect(mockApiClient.createMemory).not.toHaveBeenCalled(); // No screen context
        });
    });

    describe('recallInfo with reminder memory', () => {
        it('should detect reminder and extract file path', async () => {
            const action: Action = {
                type: 'info.recall',
                params: {
                    summary: 'You wanted to fix the authentication bug.'
                }
            };

            const reminderMemory: MemoryReference = {
                id: 'reminder-123',
                type: 'reminder',
                summary: 'Reminder: Fix auth bug',
                score: 0.95,
                metadata: {
                    screenshot: '/Users/test/.ghost/screenshots/test.png',
                    context: 'Active file: /Users/test/auth.ts\nCode: function login() {...}',
                    dueDate: '2024-12-03T00:00:00Z'
                }
            };

            const context = {
                commandId: 'test-cmd-456',
                memories: [reminderMemory]
            };

            // Mock file opening (we can't actually open files in tests)
            const openFileSpy = vi.spyOn(executor as any, 'openFile').mockResolvedValue({
                action: { type: 'file.open', params: { path: '/Users/test/auth.ts' } },
                status: 'success',
                executedAt: new Date().toISOString()
            });

            const result = await executor.execute(action, context);

            expect(result.status).toBe('success');
            expect(openFileSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'file.open',
                    params: { path: '/Users/test/auth.ts' }
                })
            );
        });

        it('should handle reminder without file path', async () => {
            const action: Action = {
                type: 'info.recall',
                params: {
                    summary: 'Generic reminder'
                }
            };

            const reminderMemory: MemoryReference = {
                id: 'reminder-789',
                type: 'reminder',
                summary: 'Reminder: Check email',
                score: 0.90,
                metadata: {
                    screenshot: '/Users/test/.ghost/screenshots/test2.png',
                    context: 'No active file',
                    dueDate: '2024-12-03T00:00:00Z'
                }
            };

            const context = {
                commandId: 'test-cmd-789',
                memories: [reminderMemory]
            };

            const openFileSpy = vi.spyOn(executor as any, 'openFile');

            const result = await executor.execute(action, context);

            expect(result.status).toBe('success');
            expect(openFileSpy).not.toHaveBeenCalled(); // No file path to open
        });

        it('should work with non-reminder memories', async () => {
            const action: Action = {
                type: 'info.recall',
                params: {
                    summary: 'Some factual information'
                }
            };

            const normalMemory: MemoryReference = {
                id: 'mem-999',
                type: 'entity.file',
                summary: 'Code documentation',
                score: 0.85,
                metadata: {}
            };

            const context = {
                commandId: 'test-cmd-999',
                memories: [normalMemory]
            };

            const openFileSpy = vi.spyOn(executor as any, 'openFile');

            const result = await executor.execute(action, context);

            expect(result.status).toBe('success');
            expect(openFileSpy).not.toHaveBeenCalled(); // Not a reminder
        });
    });
});
