/**
 * Unit tests for VectorizeAdapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorizeAdapter } from '../vectorize';

// Mock fetch globally
global.fetch = vi.fn();

describe('VectorizeAdapter', () => {
  let adapter: VectorizeAdapter;
  const config = {
    accountId: 'test-account',
    apiToken: 'test-token',
    indexName: 'test-index',
  };

  beforeEach(() => {
    adapter = new VectorizeAdapter(config);
    vi.clearAllMocks();
  });

  describe('upsert', () => {
    it('should upsert vector successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const result = await adapter.upsert(
        'mem-1',
        [0.1, 0.2, 0.3],
        { workspace_id: 'ws-1', type: 'entity' }
      );

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/upsert'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    it('should handle upsert errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid vector' }),
      } as Response);

      const result = await adapter.upsert(
        'mem-1',
        [0.1, 0.2],
        { workspace_id: 'ws-1', type: 'entity' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('vector_store');
        expect(result.error.message).toContain('Bad Request');
      }
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await adapter.upsert(
        'mem-1',
        [0.1, 0.2],
        { workspace_id: 'ws-1', type: 'entity' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('vector_store');
      }
    });
  });

  describe('search', () => {
    it('should search vectors successfully', async () => {
      const mockMatches = [
        { id: 'mem-1', score: 0.95, metadata: { workspace_id: 'ws-1', type: 'entity' } },
        { id: 'mem-2', score: 0.85, metadata: { workspace_id: 'ws-1', type: 'fact' } },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { matches: mockMatches } }),
      } as Response);

      const result = await adapter.search(
        [0.1, 0.2, 0.3],
        10,
        { workspace_id: 'ws-1' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].id).toBe('mem-1');
        expect(result.value[0].score).toBe(0.95);
      }
    });

    it('should apply type filters', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { matches: [] } }),
      } as Response);

      await adapter.search(
        [0.1, 0.2],
        10,
        { workspace_id: 'ws-1', types: ['entity', 'fact'] }
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.filter.type).toEqual({ $in: ['entity', 'fact'] });
    });

    it('should handle search errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      } as Response);

      const result = await adapter.search([0.1, 0.2], 10);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('vector_store');
      }
    });
  });

  describe('delete', () => {
    it('should delete vector successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const result = await adapter.delete('mem-1');

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/delete'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle delete errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: async () => ({}),
      } as Response);

      const result = await adapter.delete('mem-999');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('vector_store');
      }
    });
  });
});
