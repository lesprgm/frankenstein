import { describe, it, expect, vi } from 'vitest';

// Mock electron Notification to avoid native dependency
vi.mock('electron', () => {
  class StubNotification {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(opts: any) { }
    show(): void {
      // no-op
    }
  }
  return { Notification: StubNotification };
});

import { ActionExecutor } from '../src/actions/action-executor';

describe('ActionExecutor', () => {
  it('executes actions in order and returns successes', async () => {
    const executor = new ActionExecutor();
    const actions = [
      { type: 'info.recall', params: { summary: 'first' } },
      { type: 'info.recall', params: { summary: 'second' } },
    ] as any[];

    const results = await executor.executeBatch(actions);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');
  });

  it('fails unsupported action types', async () => {
    const executor = new ActionExecutor();
    const actions = [{ type: 'unknown.action', params: {} } as any];
    const results = await executor.executeBatch(actions);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('Unsupported action type');
  });

  it('should NOT provide voice feedback (echo fix)', async () => {
    const mockVoiceFeedback = {
      provideFeedback: vi.fn().mockResolvedValue(undefined),
      getAcknowledgment: vi.fn().mockReturnValue(null), // Add missing mock method
    } as any;

    const executor = new ActionExecutor(mockVoiceFeedback);
    const actions = [{ type: 'info.recall', params: { summary: 'test' } } as any];

    await executor.executeBatch(actions);

    // Verify provideFeedback is NOT called
    expect(mockVoiceFeedback.provideFeedback).not.toHaveBeenCalled();
  });
  it('should use Spotlight fallback when file path is missing', async () => {
    vi.resetModules();

    // Mock dependencies using doMock to affect the dynamic import
    const mockExec = vi.fn().mockImplementation((cmd, cb) => {
      // Handle promisified exec (which calls exec(cmd, callback))
      // or just return a promise if we mocked promisify? 
      // No, promisify wraps the function. 
      // If we mock 'exec', promisify(exec) will call our mock.
      // Our mock should accept (cmd, callback).
      cb(null, { stdout: '/spotlight/path/file.ts', stderr: '' });
    });

    const mockExecFile = vi.fn().mockImplementation((cmd, args, cb) => {
      if (typeof args === 'function') {
        cb = args;
        args = [];
      }
      cb(null, { stdout: '', stderr: '' });
    });

    vi.doMock('node:child_process', () => ({
      exec: mockExec,
      execFile: mockExecFile
    }));

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual('node:fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn()
            .mockReturnValueOnce(false) // 1. Original path fails
            .mockReturnValueOnce(true)  // 2. Spotlight path check succeeds
            .mockReturnValue(true)      // 3. Recursive openFile check succeeds
        }
      };
    });

    // Re-import to apply mocks
    const { ActionExecutor } = await import('../src/actions/action-executor');
    const executor = new ActionExecutor();

    const action = {
      type: 'file.open',
      params: { path: '/invalid/path/file.ts' }
    };

    const result = await executor.executeBatch([action as any]);

    expect(result[0].status).toBe('success');
  });
});
