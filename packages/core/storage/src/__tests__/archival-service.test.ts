
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchivalService } from '../lifecycle/archival-service.js';
import { StorageAdapter } from '../adapter.js';
import { VectorizeAdapter } from '../vectorize.js';
import { Memory } from '../models.js';

// Mock dependencies
const mockAdapter = {
  query: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
} as unknown as StorageAdapter;

const mockVectorize = {
  delete: vi.fn(),
} as unknown as VectorizeAdapter;

describe('ArchivalService Integration', () => {
  let service: ArchivalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ArchivalService(mockAdapter, mockVectorize);
  });

  describe('archiveBatch', () => {
    it('should archive memories successfully', async () => {
      const memoryIds = ['mem-1', 'mem-2'];
      const workspaceId = 'ws-1';

      // Mock query to return memories (Call 1)
      (mockAdapter.query as any).mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: 'mem-1',
            workspace_id: workspaceId,
            content: 'test 1',
            metadata: { key: 'value' },
            lifecycle_state: 'active',
            created_at: new Date(),
          },
        ],
      });

      // Mock relationship count query (Call 2)
      (mockAdapter.query as any).mockResolvedValueOnce({
        ok: true,
        value: [{ count: 5 }],
      });

      // Mock insert into archived_memories
      (mockAdapter.insert as any).mockResolvedValue({ ok: true });

      // Mock delete from memories
      (mockAdapter.delete as any).mockResolvedValue({ ok: true });

      // Mock vector delete
      (mockVectorize.delete as any).mockResolvedValue({ ok: true });

      // Since archiveBatch calls archiveSingle in a loop, we need to handle sequential calls
      // But mockResolvedValueOnce handles the sequence for the FIRST memory.
      // For the SECOND memory, we need more mocks.
      // Or we can just test with 1 memory for simplicity first.

      const result = await service.archiveBatch(['mem-1'], workspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.memoriesArchived).toBe(1);
        expect(result.value.relationshipsPreserved).toBe(5);
        expect(result.value.vectorsRemoved).toBe(1);
        expect(result.value.errors).toHaveLength(0);
      }

      expect(mockAdapter.insert).toHaveBeenCalledWith('archived_memories', expect.objectContaining({
        id: 'mem-1',
        workspace_id: workspaceId,
      }));
      expect(mockAdapter.delete).toHaveBeenCalledWith('memories', 'mem-1');
      expect(mockVectorize.delete).toHaveBeenCalledWith('mem-1');
    });

    it('should handle archival failures gracefully', async () => {
      const workspaceId = 'ws-1';

      // Mock query to fail
      (mockAdapter.query as any).mockResolvedValue({
        ok: false,
        error: { message: 'DB Error' },
      });

      const result = await service.archiveBatch(['mem-1'], workspaceId);

      expect(result.ok).toBe(true); // Batch operation itself succeeds, but contains errors
      if (result.ok) {
        expect(result.value.memoriesArchived).toBe(0);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0].memoryId).toBe('mem-1');
      }
    });
  });

  describe('restore', () => {
    it('should restore memory successfully', async () => {
      const memoryId = 'mem-1';
      const workspaceId = 'ws-1';

      // Mock query to return archived memory
      (mockAdapter.query as any).mockResolvedValue({
        ok: true,
        value: [{
          id: memoryId,
          workspace_id: workspaceId,
          content: 'test',
          metadata: JSON.stringify({ key: 'value' }),
          access_count: 1,
          importance_score: 0.5,
        }],
      });

      // Mock insert into memories
      (mockAdapter.insert as any).mockResolvedValue({ ok: true });

      // Mock delete from archived_memories
      (mockAdapter.delete as any).mockResolvedValue({ ok: true });

      const result = await service.restore(memoryId, workspaceId);

      expect(result.ok).toBe(true);
      expect(mockAdapter.insert).toHaveBeenCalledWith('memories', expect.objectContaining({
        id: memoryId,
        lifecycle_state: 'active',
        decay_score: 1.0,
      }));
      expect(mockAdapter.delete).toHaveBeenCalledWith('archived_memories', memoryId);
    });
  });

  describe('listArchived', () => {
    it('should list archived memories', async () => {
      const workspaceId = 'ws-1';

      (mockAdapter.query as any).mockResolvedValue({
        ok: true,
        value: [{
          id: 'mem-1',
          workspace_id: workspaceId,
          metadata: JSON.stringify({ key: 'value' }),
          archived_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_accessed_at: new Date().toISOString(),
        }],
      });

      const result = await service.listArchived(workspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('mem-1');
        expect(result.value[0].metadata).toEqual({ key: 'value' });
      }
    });
  });
});
