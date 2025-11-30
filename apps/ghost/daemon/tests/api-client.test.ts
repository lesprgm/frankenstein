import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GhostAPIClient } from '../src/services/api-client';
import type { DaemonConfig } from '../src/types';

const post = vi.fn();
const get = vi.fn();

vi.mock('axios', () => {
  return {
    __esModule: true,
    default: { create: () => ({ post, get }) },
    create: () => ({ post, get }),
  };
});

const baseConfig: DaemonConfig = {
  backend: { url: 'http://localhost:3000', apiKey: 'test-key' },
  user: { id: 'user-1', workspace_id: 'ws-1' },
  privacy: {
    mode: 'local-preferred',
    redact_emails_in_prompts: true,
    redact_file_paths_in_prompts: true,
    max_prompt_history_days: 14,
  },
  voice: {
    sttProvider: 'gemini',
    sttApiKey: undefined,
    ttsProvider: 'system',
    hotkey: 'Option+Space',
    silenceThreshold: 0.01,
    maxRecordingDuration: 1000,
    chimeSound: '',
  },
  files: {
    scanDirectories: [],
    includeExtensions: [],
    maxDepth: 1,
    excludePatterns: [],
  },
};

describe('GhostAPIClient', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
  });

  it('sends commands with required fields', async () => {
    post.mockResolvedValueOnce({ data: { assistant_text: 'ok', actions: [], command_id: 'cmd' } });
    const client = new GhostAPIClient(baseConfig);
    const res = await client.sendCommand('hello');
    expect(post).toHaveBeenCalled();
    const [, payload] = post.mock.calls[0];
    expect(payload.user_id).toBe('user-1');
    expect(payload.text).toBe('hello');
    expect(payload.meta.source).toBe('voice');
    expect(res.ok).toBe(true);
  });

  it('indexes files with user id', async () => {
    post.mockResolvedValueOnce({ data: { indexed: 1 } });
    const client = new GhostAPIClient(baseConfig);
    await client.indexFiles([{ path: '/tmp/a.txt', name: 'a.txt', modified: new Date().toISOString(), size: 1 }]);
    expect(post).toHaveBeenCalledWith(
      '/api/files/index',
      expect.objectContaining({ user_id: 'user-1' })
    );
  });

  it('fetches dashboard data', async () => {
    get.mockResolvedValueOnce({ data: { commands: [], stats: { totalCommands: 0, totalMemories: 0, successRate: 1 } } });
    const client = new GhostAPIClient(baseConfig);
    const res = await client.getDashboardData();
    expect(get).toHaveBeenCalledWith('/api/dashboard/commands');
    expect(res.ok).toBe(true);
  });
});
