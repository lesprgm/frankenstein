import type { Result } from '../types.js';
import type { Memory, SearchResult } from '@memorylayer/storage';

/**
 * Cluster of similar memories that should be consolidated
 */
export interface MemoryCluster {
    memories: Memory[];
    avgSimilarity: number;
}

/**
 * Consolidated memory with version history
 */
export interface ConsolidatedMemory {
    parent: Memory;
    versions: Memory[];
    consolidatedCount: number;
}

/**
 * Service for detecting and consolidating duplicate/similar memories
 */
export class MemoryConsolidationService {
    constructor(
        private db: any, // better-sqlite3 database instance
        private embeddingProvider: { embed: (text: string) => Promise<number[]> }
    ) { }

    /**
     * Find clusters of similar memories above the similarity threshold
     * 
     * @param workspaceId - Workspace to search
     * @param threshold - Cosine similarity threshold (default: 0.85)
     * @returns Array of memory clusters
     */
    async findSimilarMemories(
        workspaceId: string,
        threshold = 0.85
    ): Promise<Result<MemoryCluster[], { type: 'error'; message: string }>> {
        try {
            // Fetch all active memories with embeddings
            const memories = this.db
                .prepare(
                    `SELECT id, type, content, confidence, metadata, embedding, created_at
           FROM memories
           WHERE workspace_id = ? AND is_active = TRUE AND embedding IS NOT NULL
           ORDER BY created_at DESC`
                )
                .all(workspaceId) as Array<Memory & { embedding: string; created_at: string }>;

            if (memories.length === 0) {
                return { ok: true, value: [] };
            }

            // Parse embeddings
            const memoryEmbeddings = memories.map((m) => ({
                memory: m,
                embedding: JSON.parse(m.embedding),
            }));

            // Compute pairwise similarities and cluster
            const clusters: MemoryCluster[] = [];
            const processed = new Set<string>();

            for (let i = 0; i < memoryEmbeddings.length; i++) {
                if (processed.has(memoryEmbeddings[i].memory.id)) continue;

                const cluster: Memory[] = [memoryEmbeddings[i].memory];
                const similarities: number[] = [];

                for (let j = i + 1; j < memoryEmbeddings.length; j++) {
                    if (processed.has(memoryEmbeddings[j].memory.id)) continue;

                    const similarity = this.cosineSimilarity(
                        memoryEmbeddings[i].embedding,
                        memoryEmbeddings[j].embedding
                    );

                    if (similarity >= threshold) {
                        cluster.push(memoryEmbeddings[j].memory);
                        similarities.push(similarity);
                        processed.add(memoryEmbeddings[j].memory.id);
                    }
                }

                if (cluster.length > 1) {
                    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
                    clusters.push({ memories: cluster, avgSimilarity });
                }

                processed.add(memoryEmbeddings[i].memory.id);
            }

            return { ok: true, value: clusters };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Consolidate a cluster of similar memories
     * 
     * @param cluster - Cluster of similar memories
     * @returns Consolidated memory result
     */
    async consolidateCluster(
        cluster: MemoryCluster
    ): Promise<Result<ConsolidatedMemory, { type: 'error'; message: string }>> {
        try {
            if (cluster.memories.length < 2) {
                return {
                    ok: false,
                    error: { type: 'error', message: 'Cluster must have at least 2 memories' },
                };
            }

            // Sort by created_at DESC to keep most recent as parent
            const sorted = [...cluster.memories].sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            const parent = sorted[0];
            const versions = sorted.slice(1);

            // Begin transaction
            const consolidate = this.db.transaction(() => {
                const now = new Date().toISOString();

                // Mark older versions as inactive and link to parent
                const updateStmt = this.db.prepare(
                    `UPDATE memories
           SET is_active = FALSE,
               parent_memory_id = ?,
               consolidated_at = ?
           WHERE id = ?`
                );

                for (const version of versions) {
                    updateStmt.run(parent.id, now, version.id);
                }

                // Update parent version number
                this.db
                    .prepare(
                        `UPDATE memories
             SET version = ?
             WHERE id = ?`
                    )
                    .run(versions.length + 1, parent.id);

                // Merge metadata (combine sources, keep max confidence)
                const allMetadata = cluster.memories.map((m) =>
                    m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : {}
                );

                const mergedMetadata = {
                    ...parent.metadata,
                    sources: Array.from(
                        new Set(allMetadata.flatMap((m) => (m.sources ? [m.sources] : [])).flat())
                    ),
                    consolidatedCount: versions.length,
                    consolidatedAt: now,
                };

                this.db
                    .prepare(
                        `UPDATE memories
             SET metadata = ?,
                 confidence = ?
             WHERE id = ?`
                    )
                    .run(
                        JSON.stringify(mergedMetadata),
                        Math.max(...cluster.memories.map((m) => m.confidence)),
                        parent.id
                    );
            });

            consolidate();

            return {
                ok: true,
                value: {
                    parent,
                    versions,
                    consolidatedCount: versions.length,
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Get version history for a memory
     * 
     * @param memoryId - Memory ID
     * @returns Memory with its version history
     */
    async getVersionHistory(
        memoryId: string
    ): Promise<Result<ConsolidatedMemory, { type: 'error'; message: string }>> {
        try {
            // Fetch the memory
            const parent = this.db
                .prepare('SELECT * FROM memories WHERE id = ? AND is_active = TRUE')
                .get(memoryId) as Memory | undefined;

            if (!parent) {
                return {
                    ok: false,
                    error: { type: 'error', message: 'Memory not found' },
                };
            }

            // Fetch versions
            const versions = this.db
                .prepare(
                    `SELECT * FROM memories
           WHERE parent_memory_id = ?
           ORDER BY created_at DESC`
                )
                .all(memoryId) as Memory[];

            return {
                ok: true,
                value: {
                    parent,
                    versions,
                    consolidatedCount: versions.length,
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            magnitudeA += a[i] * a[i];
            magnitudeB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
        return magnitude === 0 ? 0 : dotProduct / magnitude;
    }
}
