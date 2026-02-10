import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/actions/action-executor';

// Mock 'open' package
const mockOpen = vi.fn();
vi.mock('open', () => ({
  default: mockOpen,
}));

describe('ActionExecutor - System Actions Safety', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ActionExecutor();
  });

  it('should allow safe protocols (https)', async () => {
    const action = {
      type: 'system.open' as const,
      params: { target: 'https://google.com' },
    };
    const result = await executor.execute(action);
    expect(result.status).toBe('success');
    expect(mockOpen).toHaveBeenCalledWith('https://google.com');
  });

  it('should allow app-specific protocols (spotify)', async () => {
    const action = {
      type: 'system.open' as const,
      params: { target: 'spotify:track:123' },
    };
    const result = await executor.execute(action);
    expect(result.status).toBe('success');
  });

  it('should block unsafe protocols (javascript)', async () => {
    const action = {
      type: 'system.open' as const,
      params: { target: 'javascript:alert(1)' },
    };
    const result = await executor.execute(action);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Blocked potentially unsafe protocol');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('should block unsafe protocols (file)', async () => {
    // Note: 'file://' is technically a protocol. Our check catches it.
    // If we want to allow local files, we should add 'file' to the whitelist,
    // but usually file.open action handles that separately.
    const action = {
      type: 'system.open' as const,
      params: { target: 'file:///etc/passwd' },
    };
    const result = await executor.execute(action);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Blocked potentially unsafe protocol');
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
