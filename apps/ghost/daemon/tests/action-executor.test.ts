import { describe, it, expect, vi } from 'vitest';

// Mock electron Notification to avoid native dependency
vi.mock('electron', () => {
  class StubNotification {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(opts: any) {}
    show(): void {
      // no-op
    }
  }
  return { Notification: StubNotification };
});

import { actionExecutor } from '../src/actions/action-executor';

describe('ActionExecutor', () => {
  it('executes actions in order and returns successes', async () => {
    const actions = [
      { type: 'info.recall', params: { summary: 'first' } },
      { type: 'info.recall', params: { summary: 'second' } },
    ] as any[];

    const results = await actionExecutor.executeBatch(actions);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');
  });

  it('fails unsupported action types', async () => {
    const actions = [{ type: 'unknown.action', params: {} } as any];
    const results = await actionExecutor.executeBatch(actions);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('Unsupported action type');
  });
});
