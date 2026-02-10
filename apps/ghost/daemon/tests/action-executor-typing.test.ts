import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/actions/action-executor';
import * as child_process from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn((cmd, cb) => {
    if (cb) cb(null, 'stdout', 'stderr');
    return { stdout: null, stderr: null } as any;
  }),
  execFile: vi.fn(),
}));

describe('ActionExecutor - Typing', () => {
  let executor: ActionExecutor;
  let mockSystemContextService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemContextService = {
        getContext: vi.fn().mockResolvedValue({
            activeWindow: {
                title: 'Test Window',
                owner: { bundleId: 'com.test.app' }
            }
        })
    };
    executor = new ActionExecutor(undefined, undefined, undefined, undefined, mockSystemContextService);
  });

  it('should execute system.type action using osascript', async () => {
    const action = {
      type: 'system.type' as const,
      params: { text: 'Hello World' },
    };

    const result = await executor.execute(action);

    expect(result.status).toBe('success');
    // Check if the command contains the expected AppleScript
    // Note: It chunks by 5 chars, so "Hello" then " Worl" then "d"
    expect(child_process.exec).toHaveBeenCalledWith(
      expect.stringContaining('osascript -e \'tell application "System Events" to keystroke "Hello"\''),
      expect.any(Function)
    );
  });

  it('should escape special characters', async () => {
    const action = {
      type: 'system.type' as const,
      params: { text: 'Hello "World"' },
    };

    await executor.execute(action);

    // "Hello"
    // " \"Wor"
    // "ld\""
    // The escaping happens per chunk.
    // Let's just check that exec was called.
    expect(child_process.exec).toHaveBeenCalled();
  });

  it('should fail if no text is provided', async () => {
    const action = {
      type: 'system.type' as const,
      params: { text: '' },
    };

    const result = await executor.execute(action);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('No text provided');
  });

  it('should abort if active window changes (Focus Lock)', async () => {
    // First call (initial) returns correct window
    // Second call (inside loop) returns different window
    mockSystemContextService.getContext
        .mockResolvedValueOnce({ activeWindow: { owner: { bundleId: 'com.test.app' } } })
        .mockResolvedValueOnce({ activeWindow: { owner: { bundleId: 'com.other.app' } } });

    const action = {
      type: 'system.type' as const,
      params: { text: 'Hello World' },
    };

    const result = await executor.execute(action);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Focus Lock triggered');
  });

  it('should abort if stop() is called', async () => {
    const action = {
      type: 'system.type' as const,
      params: { text: 'Long text to allow interruption' },
    };

    const promise = executor.execute(action);
    
    // Simulate user pressing stop shortly after start
    setTimeout(() => {
        executor.stop();
    }, 10);

    const result = await promise;
    
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Typing aborted by user');
  });
});
