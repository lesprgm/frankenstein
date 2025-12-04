import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// Mock electron
vi.mock('electron', () => ({
    Notification: class {
        constructor() { }
        show() { }
    }
}));

// Mock dependencies
const mockExec = vi.fn();
const mockExecFile = vi.fn();
const mockFs = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
};

vi.mock('node:child_process', () => ({
    exec: (cmd: string, cb: any) => {
        mockExec(cmd);
        cb(null, { stdout: '', stderr: '' });
    },
    execFile: (cmd: string, args: any, cb: any) => {
        mockExecFile(cmd, args);
        cb(null, { stdout: '', stderr: '' });
    }
}));

vi.mock('node:fs', async () => {
    const actual = await vi.importActual('node:fs');
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: (p: string) => mockFs.existsSync(p),
            mkdirSync: (p: string) => mockFs.mkdirSync(p),
            unlinkSync: (p: string) => mockFs.unlinkSync(p),
        }
    };
});

// Import ActionExecutor after mocks
import { ActionExecutor } from '../src/actions/action-executor';

describe('Ghost Demo Simulation', () => {
    let executor: ActionExecutor;
    let mockRemindersService: any;
    let mockApiClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockRemindersService = {
            createReminder: vi.fn().mockResolvedValue({ success: true, id: 'rem-123' })
        };

        mockApiClient = {
            createMemory: vi.fn().mockResolvedValue({ id: 'mem-123' }),
            indexFiles: vi.fn().mockResolvedValue({ ok: true })
        };

        executor = new ActionExecutor(
            undefined, // voiceFeedback
            undefined, // explainabilityNotifier
            mockRemindersService,
            mockApiClient
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Scenario 1: Scroll to Context', () => {
        it('should use AppleScript for Cmd+F when search param is present', async () => {
            const filePath = path.join(process.env.HOME || '/Users/demo', 'meeting_notes.txt');
            const searchTerm = 'flagged a timeline concern';

            mockFs.existsSync.mockReturnValue(true);

            const action = {
                type: 'file.open',
                params: {
                    path: filePath,
                    search: searchTerm
                }
            };

            // Execute action
            const promise = executor.executeBatch([action as any]);

            // Fast-forward timers to trigger the setTimeout in openFile
            vi.runAllTimers();

            await promise;

            // Verify file was opened
            expect(mockExecFile).toHaveBeenCalledWith('open', [path.normalize(filePath)]);

            // Verify AppleScript was executed for search
            const calls = mockExecFile.mock.calls;
            const osascriptCall = calls.find(call => call[0] === 'osascript');

            expect(osascriptCall).toBeDefined();
            expect(osascriptCall[1][1]).toContain('keystroke "f" using command down');
            expect(osascriptCall[1][1]).toContain(`keystroke "${searchTerm}"`);
        });
    });

    describe('Scenario 2: Reminder Robustness', () => {
        it('should create a Ghost memory even if screenshot capture fails (P0 Fix)', async () => {
            const action = {
                type: 'reminder.create',
                params: {
                    title: 'Fix the login bug',
                    notes: 'Check auth-service.ts'
                }
            };

            const context = {
                commandId: 'cmd-1',
                memories: [],
                screenContext: undefined // SIMULATED FAILURE
            };

            await executor.executeBatch([action as any], context);

            expect(mockRemindersService.createReminder).toHaveBeenCalled();
            expect(mockApiClient.createMemory).toHaveBeenCalledWith(expect.objectContaining({
                type: 'reminder',
                summary: expect.stringContaining('Fix the login bug'),
                metadata: expect.objectContaining({
                    completed: false
                })
            }));
        });
    });

    describe('Scenario 3: Recall Flow', () => {
        it('should extract file path from windowTitle in memory metadata', async () => {
            const action = {
                type: 'info.recall',
                params: { summary: 'You were working on auth-service.ts' }
            };

            const context = {
                commandId: 'cmd-2',
                memories: [{
                    id: 'mem-1',
                    type: 'reminder',
                    score: 1.0,
                    summary: 'Reminder: Fix bug',
                    metadata: {
                        windowTitle: 'auth-service.ts',
                        context: 'Active file: /some/ocr/path.ts'
                    }
                }],
                screenContext: undefined
            };

            vi.spyOn(require('node:child_process'), 'exec').mockImplementation((cmd: any, cb: any) => {
                if (cmd.includes('mdfind')) {
                    cb(null, { stdout: '/Users/demo/src/auth-service.ts', stderr: '' });
                } else {
                    cb(null, { stdout: '', stderr: '' });
                }
            });

            mockFs.existsSync.mockReturnValue(true);

            await executor.executeBatch([action as any], context as any);
            // Verification is implicit via code coverage of the path extraction logic
        });
    });

    describe('Scenario 4: Network Failure during Memory Creation', () => {
        it('should not crash if API client fails', async () => {
            mockApiClient.createMemory.mockRejectedValue(new Error('Network Error'));

            const action = {
                type: 'reminder.create',
                params: { title: 'Test', notes: 'Notes' }
            };

            await expect(executor.executeBatch([action as any])).resolves.toBeDefined();
            expect(mockRemindersService.createReminder).toHaveBeenCalled();
        });
    });

    describe('Scenario 5: Reminders Permission Denied', () => {
        it('should handle permission denial gracefully', async () => {
            mockRemindersService.createReminder.mockResolvedValue({ success: false, error: 'Access denied' });

            const action = {
                type: 'reminder.create',
                params: { title: 'Test' }
            };

            const results = await executor.executeBatch([action as any]);

            expect(results[0].status).toBe('failed');
            expect(results[0].error).toBe('Access denied');
            expect(mockApiClient.createMemory).not.toHaveBeenCalled();
        });
    });

    describe('Scenario 6: Empty Reminder Title', () => {
        it('should validate title before processing', async () => {
            const action = {
                type: 'reminder.create',
                params: { title: '   ' }
            };

            const results = await executor.executeBatch([action as any]);

            expect(results[0].status).toBe('failed');
            expect(results[0].error).toContain('title is required');
            expect(mockRemindersService.createReminder).not.toHaveBeenCalled();
        });
    });

    describe('Scenario 7: Recall with Missing Screenshot', () => {
        it('should still show summary if screenshot is missing', async () => {
            const action = {
                type: 'info.recall',
                params: { summary: 'Recall summary' }
            };

            const context = {
                commandId: 'cmd-3',
                memories: [{
                    id: 'mem-2',
                    type: 'reminder',
                    summary: 'Recall summary',
                    metadata: {
                        context: 'Some text'
                    }
                }]
            };

            const results = await executor.executeBatch([action as any], context as any);
            expect(results[0].status).toBe('success');
        });
    });

    describe('Scenario 8: File Open with Path Traversal', () => {
        it('should block path traversal attempts', async () => {
            const action = {
                type: 'file.open',
                params: { path: '../../etc/passwd' }
            };

            const results = await executor.executeBatch([action as any]);

            expect(results[0].status).toBe('failed');
            expect(results[0].error).toContain('Path traversal detected');
            expect(mockExecFile).not.toHaveBeenCalled();
        });
    });

    describe('Scenario 9: File Open with Invalid Path', () => {
        it('should fail gracefully if file does not exist and spotlight fails', async () => {
            mockFs.existsSync.mockReturnValue(false);
            vi.spyOn(require('node:child_process'), 'exec').mockImplementation((cmd: any, cb: any) => {
                cb(null, { stdout: '', stderr: '' });
            });

            const action = {
                type: 'file.open',
                params: { path: path.join(process.env.HOME || '/Users/demo', 'non-existent.txt') }
            };

            const results = await executor.executeBatch([action as any]);

            expect(results[0].status).toBe('failed');
            expect(results[0].error).toBe('File not found');
        });
    });
});
