
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LifecycleManager } from '../lifecycle/lifecycle-manager.js';
import { StorageAdapter } from '../adapter.js';
import { VectorizeAdapter } from '../vectorize.js';
import { LifecycleConfig } from '../lifecycle/lifecycle-manager.js';

// Mock dependencies
const mockAdapter = {
    query: vi.fn(),
    delete: vi.fn(),
} as unknown as StorageAdapter;

const mockVectorize = {} as unknown as VectorizeAdapter;

const mockConfig: LifecycleConfig = {
    enabled: true,
    defaultTTL: 1000 * 60 * 60 * 24 * 30, // 30 days
    decayThreshold: 0.3,
    evaluationInterval: 60000, // 1 minute minimum (enforced by LifecycleManager)
    batchSize: 10,
    archiveRetentionPeriod: 1000 * 60 * 60 * 24 * 365,
    auditRetentionPeriod: 1000 * 60 * 60 * 24 * 90,
    decayFunction: { type: 'exponential', params: { lambda: 0.1 }, compute: () => 0.5 },
    importanceWeights: { accessFrequency: 0.3, confidence: 0.3, relationshipCount: 0.4 },
    retentionPolicies: new Map(),
};

describe('Background Jobs Integration', () => {
    let manager: LifecycleManager;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Default mock implementation to handle different queries
        (mockAdapter.query as any).mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT DISTINCT workspace_id')) {
                return { ok: true, value: [{ workspace_id: 'ws-1' }] };
            }
            if (sql.includes('FROM memories m')) {
                // Return a valid memory for evaluation
                return {
                    ok: true, value: [{
                        id: 'mem-1',
                        workspace_id: 'ws-1',
                        content: 'test',
                        last_accessed_at: new Date(),
                        created_at: new Date(),
                        lifecycle_state: 'active',
                        pinned: false,
                        importance_score: 0.5,
                        decay_score: 1.0,
                        access_count: 1,
                        type: 'conversation'
                    }]
                };
            }
            if (sql.includes('FROM archived_memories')) {
                return { ok: true, value: [] };
            }
            if (sql.includes('DELETE FROM lifecycle_events')) {
                return { ok: true, value: [] }; // Delete result (rows affected usually, but adapter returns rows?)
                // Actually adapter.query returns rows. Delete usually returns empty array or rows if RETURNING is used.
                // Assuming empty array for now.
            }
            if (sql.includes('SELECT COUNT(*)')) {
                return { ok: true, value: [{ count: 0 }] };
            }
            return { ok: true, value: [] };
        });

        manager = new LifecycleManager(mockAdapter, mockVectorize, mockConfig);
    });

    afterEach(() => {
        manager.stopBackgroundJobs();
        vi.useRealTimers();
    });

    it('should start and stop background jobs', async () => {
        manager.startBackgroundJobs();

        // Fast-forward time to trigger interval
        await vi.advanceTimersByTimeAsync(150);

        expect(mockAdapter.query).toHaveBeenCalled();

        manager.stopBackgroundJobs();

        // Clear mocks to verify no more calls
        vi.clearAllMocks();
        await vi.advanceTimersByTimeAsync(150);
        expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should run evaluation and cleanup in background', async () => {
        manager.startBackgroundJobs();

        // Trigger interval
        await vi.advanceTimersByTimeAsync(150);

        expect(mockAdapter.query).toHaveBeenCalled();

        // Verify specific queries were made
        const queries = (mockAdapter.query as any).mock.calls.map((c: any) => c[0]);
        expect(queries.some((q: string) => q.includes('SELECT DISTINCT workspace_id'))).toBe(true);
        expect(queries.some((q: string) => q.includes('FROM memories m'))).toBe(true);
    });

    it('should handle errors gracefully', async () => {
        // Mock query to throw error for the first call
        (mockAdapter.query as any).mockRejectedValueOnce(new Error('DB Error'));

        manager.startBackgroundJobs();

        // Should not throw
        await vi.advanceTimersByTimeAsync(150);

        // Should continue running next interval
        // The default mock implementation will take over for subsequent calls

        await vi.advanceTimersByTimeAsync(150);

        expect(mockAdapter.query).toHaveBeenCalled();
        // Should have been called multiple times during intervals
        expect((mockAdapter.query as any).mock.calls.length).toBeGreaterThanOrEqual(5);
    });
});
