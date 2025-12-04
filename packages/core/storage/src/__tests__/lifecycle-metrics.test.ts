import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LifecycleManager } from '../lifecycle/lifecycle-manager.js';
import { StorageAdapter } from '../adapter.js';
import { VectorizeAdapter } from '../../vectorize.js';
import { LifecycleConfig } from '../lifecycle-manager.js';

describe('LifecycleManager Metrics', () => {
    let manager: LifecycleManager;
    let mockAdapter: any;
    let mockVectorize: any;
    let mockLogger: any;

    const config: LifecycleConfig = {
        enabled: true,
        defaultTTL: 86400000,
        retentionPolicies: new Map(),
        decayFunction: { type: 'exponential', params: { lambda: 0.1 }, compute: () => 0.5 },
        decayThreshold: 0.5,
        importanceWeights: { accessFrequency: 0.3, confidence: 0.3, relationshipCount: 0.4 },
        evaluationInterval: 60000,
        batchSize: 100,
        archiveRetentionPeriod: 86400000,
        auditRetentionPeriod: 86400000,
    };

    beforeEach(() => {
        mockAdapter = {
            query: vi.fn(),
        };
        mockVectorize = {};
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        };

        manager = new LifecycleManager(
            mockAdapter as StorageAdapter,
            mockVectorize as VectorizeAdapter,
            config,
            mockLogger
        );
    });

    it('should collect correct metrics', async () => {
        const workspaceId = 'ws1';

        // Mock state counts query (query 1)
        mockAdapter.query.mockResolvedValueOnce({
            ok: true,
            value: [
                { lifecycle_state: 'active', count: 10, size: 1000 },
                { lifecycle_state: 'decaying', count: 5, size: 500 },
            ],
        });

        // Mock pinned count query (query 2)
        mockAdapter.query.mockResolvedValueOnce({
            ok: true,
            value: [{ count: 2 }],
        });

        // Mock storage by state query (query 3)
        mockAdapter.query.mockResolvedValueOnce({
            ok: true,
            value: [
                { lifecycle_state: 'active', storage: 1000 },
                { lifecycle_state: 'decaying', storage: 500 },
            ],
        });

        // Mock archived stats query (query 4)
        mockAdapter.query.mockResolvedValueOnce({
            ok: true,
            value: [{ count: 3, size: 300 }],
        });

        // Mock average scores query (query 5)
        mockAdapter.query.mockResolvedValueOnce({
            ok: true,
            value: [{ avg_decay: 0.8, avg_importance: 0.6 }],
        });

        const result = await manager.getMetrics(workspaceId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const metrics = result.value;

        expect(metrics.totalMemories).toBe(15); // 10 active + 5 decaying
        expect(metrics.stateCounts.active).toBe(10);
        expect(metrics.stateCounts.decaying).toBe(5);
        expect(metrics.stateCounts.archived).toBe(3);
        expect(metrics.storageByState.active).toBe(1000);
        expect(metrics.pinnedMemories).toBe(2);
        expect(metrics.averageDecayScore).toBe(0.8);
        expect(metrics.averageImportanceScore).toBe(0.6);
    });

    it('should handle empty database gracefully', async () => {
        const workspaceId = 'ws1';

        // Mock empty results
        mockAdapter.query.mockResolvedValue({ ok: true, value: [] });

        const result = await manager.getMetrics(workspaceId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const metrics = result.value;

        expect(metrics.totalMemories).toBe(0);
        expect(metrics.stateCounts.active).toBe(0);
        expect(metrics.averageDecayScore).toBe(0);
    });
});
