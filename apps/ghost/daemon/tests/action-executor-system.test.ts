import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/actions/action-executor';

// Mock 'open' package
const mockOpen = vi.fn();
vi.mock('open', () => ({
  default: mockOpen,
}));

describe('ActionExecutor - System Actions', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ActionExecutor();
  });

  it('should execute system.open with a URL', async () => {
    const action = {
      type: 'system.open' as const,
      params: { target: 'https://google.com' },
    };

    const result = await executor.execute(action);

    expect(mockOpen).toHaveBeenCalledWith('https://google.com');
    expect(result.status).toBe('success');
  });

  it('should execute system.open with an app', async () => {
    const action = {
      type: 'system.open' as const,
      params: { target: 'https://spotify.com', app: 'Spotify' },
    };

    const result = await executor.execute(action);

    expect(mockOpen).toHaveBeenCalledWith('https://spotify.com', { app: { name: 'Spotify' } });
    expect(result.status).toBe('success');
  });

  it('should handle open failures gracefully', async () => {
    mockOpen.mockRejectedValue(new Error('App not found'));
    const action = {
      type: 'system.open' as const,
      params: { target: 'invalid' },
    };

    const result = await executor.execute(action);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('App not found');
  });
});
