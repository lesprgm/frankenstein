import { Hono } from 'hono';
import crypto from 'node:crypto';
import type { Result } from '../types.js';
import { MemoryConsolidationService } from '../services/memory-consolidation.js';
import { memoryLayerIntegration } from '../services/memory-layer-integration.js';
import { storageService } from '../services/storage.js';

const app = new Hono();

/**
 * POST /api/memories/create
 * Create a memory (for demo mode reminder storage)
 */
app.post('/create', async (c) => {
    try {
        const body = await c.req.json();
        const { user_id, type, summary, metadata, timestamp } = body;

        if (!user_id || !type || !summary) {
            return c.json({ error: 'user_id, type, and summary are required' }, 400);
        }

        // Store the memory directly in storage
        const db = (storageService as any).db;
        const id = crypto.randomUUID();

        const result = await db.run(
            `INSERT INTO memories (id, workspace_id, type, content, embedding, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                user_id,
                type,
                summary,
                null, // No embedding for reminders yet
                JSON.stringify(metadata || {}),
                timestamp || new Date().toISOString(),
                new Date().toISOString()
            ]
        );

        if (!result.ok) {
            return c.json({ error: 'Failed to create memory' }, 500);
        }

        console.log('[Ghost][Memories] Created reminder memory:', id);
        return c.json({ id });
    } catch (error) {
        console.error('[Ghost][Memories] Create error:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
});

/**
 * POST /api/memories/consolidate
 * Find and consolidate similar memories
 */
app.post('/consolidate', async (c) => {
    try {
        const body = await c.req.json();
        const workspaceId = body.workspace_id || body.user_id;
        const threshold = body.threshold || 0.85;
        const dryRun = body.dryRun || false;

        if (!workspaceId) {
            return c.json({ error: 'workspace_id or user_id is required' }, 400);
        }

        // Get storage client and embedding provider
        const db = (storageService as any).db;
        const embeddingProvider = (memoryLayerIntegration as any).embeddingProvider;

        const consolidationService = new MemoryConsolidationService(db, embeddingProvider);

        // Find similar memories
        const clustersResult = await consolidationService.findSimilarMemories(workspaceId, threshold);

        if (!clustersResult.ok) {
            return c.json({ error: clustersResult.error.message }, 500);
        }

        const clusters = clustersResult.value;

        if (dryRun) {
            // Preview mode - don't actually consolidate
            return c.json({
                clusters: clusters.length,
                estimated_consolidations: clusters.reduce((sum, cluster) => sum + cluster.memories.length - 1, 0),
                preview: clusters.map((cluster) => ({
                    cluster_size: cluster.memories.length,
                    avg_similarity: cluster.avgSimilarity,
                    memories: cluster.memories.map((m) => ({
                        id: m.id,
                        type: m.type,
                        content: m.content.substring(0, 100) + '...',
                        created_at: m.created_at,
                    })),
                })),
            });
        }

        // Actually consolidate
        const results = [];
        for (const cluster of clusters) {
            const result = await consolidationService.consolidateCluster(cluster);
            if (result.ok) {
                results.push(result.value);
            }
        }

        return c.json({
            clusters: clusters.length,
            consolidated: results.length,
            total_memories_consolidated: results.reduce((sum, r) => sum + r.consolidatedCount, 0),
        });
    } catch (error) {
        console.error('[Ghost][Consolidation] Error:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
});

/**
 * GET /api/memories/:id/history
 * Get version history for a memory
 */
app.get('/:id/history', async (c) => {
    try {
        const memoryId = c.req.param('id');

        const db = (storageService as any).db;
        const embeddingProvider = (memoryLayerIntegration as any).embeddingProvider;

        const consolidationService = new MemoryConsolidationService(db, embeddingProvider);

        const result = await consolidationService.getVersionHistory(memoryId);

        if (!result.ok) {
            return c.json({ error: result.error.message }, 404);
        }

        return c.json({
            parent: result.value.parent,
            versions: result.value.versions,
            total_versions: result.value.consolidatedCount,
        });
    } catch (error) {
        console.error('[Ghost][Consolidation] Error:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
});

export default app;
