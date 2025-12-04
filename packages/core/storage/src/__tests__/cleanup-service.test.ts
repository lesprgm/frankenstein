
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CleanupService } from '../lifecycle/cleanup-service.js';
import { StorageAdapter } from '../adapter.js';

// Mock dependencies
const mockAdapter = {
    query: vi.fn(),
    delete: vi.fn(),
} as unknown as StorageAdapter;

describe('CleanupService Integration', () => {
    let service: CleanupService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new CleanupService(mockAdapter);
    });

    describe('cleanupExpired', () => {
        it('should cleanup expired memories successfully', async () => {
            const workspaceId = 'ws-1';

            // Mock query to return expired memory IDs (Call 1)
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [
                    { id: 'mem-1', content: 'test 1', metadata: '{}' },
                    { id: 'mem-2', content: 'test 2', metadata: '{}' }
                ],
            });

            // Mock relationship count queries (Call 2, Call 4)
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [{ count: 2 }],
            });

            // Mock delete relationships (Call 3)
            (mockAdapter.query as any).mockResolvedValueOnce({ ok: true, value: [] });

            // Mock relationship count for second memory (Call 4)
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [{ count: 0 }],
            });

            // Mock delete from archived_memories
            (mockAdapter.delete as any).mockResolvedValue({ ok: true });

            const result = await service.cleanupExpired(workspaceId, { batchSize: 10 });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.memoriesDeleted).toBe(2);
                expect(result.value.relationshipsDeleted).toBe(2); // Only from first memory
                expect(result.value.errors).toHaveLength(0);
            }

            // Verify query for expired memories
            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT id, content, metadata FROM archived_memories'),
                expect.arrayContaining([workspaceId])
            );

            // Verify delete calls
            expect(mockAdapter.delete).toHaveBeenCalledTimes(2);
            expect(mockAdapter.delete).toHaveBeenCalledWith('archived_memories', 'mem-1');
            expect(mockAdapter.delete).toHaveBeenCalledWith('archived_memories', 'mem-2');
        });

        it('should handle cleanup failures gracefully', async () => {
            const workspaceId = 'ws-1';

            // Mock query to return expired memory IDs with expires_at in the past
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [{
                    id: 'mem-1',
                    content: 'test',
                    metadata: '{}',
                    expires_at: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
                }],
            });

            // Mock relationship count query
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [{ count: 0 }],
            });

            // Mock delete to fail
            (mockAdapter.delete as any).mockResolvedValueOnce({
                ok: false,
                error: { type: 'database', message: 'DB Error' },
            });

            const result = await service.cleanupExpired(workspaceId);

            expect(result.ok).toBe(true); // Overall operation succeeds (partial failure)
            if (result.ok) {
                expect(result.value.memoriesDeleted).toBe(0);
                expect(result.value.errors).toHaveLength(1);
                expect(result.value.errors[0].memoryId).toBe('mem-1');
            }
        });
    });

    describe('cleanupLifecycleEvents', () => {
        it('should cleanup old lifecycle events', async () => {
            const workspaceId = 'ws-1';
            const retentionPeriodMs = 1000 * 60 * 60 * 24; // 1 day

            // Mock delete query (adapter.query is used for DELETE with WHERE clause usually, or adapter.delete for ID)
            // CleanupService uses adapter.query for bulk delete?
            // Let's check implementation. Assuming it uses adapter.query with DELETE statement.

            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [], // Result of DELETE
            });

            // Mock count query
            (mockAdapter.query as any).mockResolvedValueOnce({
                ok: true,
                value: [{ count: 10 }], // Remaining events
            });

            const result = await service.cleanupLifecycleEvents(workspaceId, retentionPeriodMs);

            expect(result.ok).toBe(true);

            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM lifecycle_events'),
                expect.any(Array)
            );
        });
    });
});
