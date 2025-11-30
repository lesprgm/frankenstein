import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type {
    User,
    Workspace,
    Conversation,
    Memory,
    Relationship,
    SearchQuery,
    SearchResult,
    ConversationFilters,
    MemoryFilters,
} from '@memorylayer/storage';
import type { Result } from '@memorylayer/storage';

/**
 * Local storage adapter for MemoryLayer
 * Implements MemoryLayer's StorageClient interface using SQLite
 * Privacy: All data stored locally, no cloud sync
 */
export class LocalStorageClient {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    /**
     * Create a new user
     */
    async createUser(data: { id?: string; email: string; name: string }): Promise<Result<User, any>> {
        try {
            const result = this.db.prepare(`
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `).get(
                data.id || crypto.randomUUID(),
                data.email,
                data.name
            ) as any;

            return {
                ok: true,
                value: {
                    ...result,
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to create user',
                },
            };
        }
    }

    /**
     * Get user by ID
     */
    async getUser(id: string): Promise<Result<User | null, any>> {
        try {
            const result = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;

            if (!result) {
                return { ok: true, value: null };
            }

            return {
                ok: true,
                value: {
                    ...result,
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to get user',
                },
            };
        }
    }

    /**
     * Create a new workspace
     */
    async createWorkspace(data: {
        id?: string;
        name: string;
        type: 'personal' | 'team';
        owner_id: string;
    }): Promise<Result<Workspace, any>> {
        try {
            const result = this.db.prepare(`
        INSERT INTO workspaces (id, name, type, owner_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `).get(
                data.id || `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                data.name,
                data.type,
                data.owner_id
            ) as any;

            return {
                ok: true,
                value: {
                    ...result,
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to create workspace',
                },
            };
        }
    }

    /**
     * Get workspace by ID
     */
    async getWorkspace(id: string): Promise<Result<Workspace | null, any>> {
        try {
            const result = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;

            if (!result) {
                return { ok: true, value: null };
            }

            return {
                ok: true,
                value: {
                    ...result,
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to get workspace',
                },
            };
        }
    }

    /**
     * List workspaces for a user
     */
    async listUserWorkspaces(userId: string): Promise<Result<Workspace[], any>> {
        try {
            const results = this.db.prepare(`
        SELECT * FROM workspaces WHERE owner_id = ? ORDER BY created_at DESC
      `).all(userId) as any[];

            return {
                ok: true,
                value: results.map(r => ({
                    ...r,
                    created_at: new Date(r.created_at),
                    updated_at: new Date(r.updated_at),
                })),
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to list workspaces',
                },
            };
        }
    }

    /**
     * Create a new memory with optional embedding
     */
    async createMemory(data: {
        workspace_id: string;
        conversation_id?: string | null;
        type: string;
        content: string;
        confidence: number;
        metadata?: Record<string, any>;
        embedding?: number[];
    }): Promise<Result<Memory, any>> {
        try {
            const id = `memory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const result = this.db.prepare(`
        INSERT INTO memories (
          id, workspace_id, conversation_id, type, content, 
          confidence, metadata, embedding, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `).get(
                id,
                data.workspace_id,
                data.conversation_id || null,
                data.type,
                data.content,
                data.confidence,
                JSON.stringify(data.metadata || {}),
                data.embedding ? JSON.stringify(data.embedding) : null
            ) as any;

            return {
                ok: true,
                value: {
                    ...result,
                    metadata: JSON.parse(result.metadata),
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to create memory',
                },
            };
        }
    }

    /**
     * Get memory by ID
     */
    async getMemory(id: string, workspaceId: string): Promise<Result<Memory | null, any>> {
        try {
            const result = this.db.prepare(`
        SELECT * FROM memories WHERE id = ? AND workspace_id = ?
      `).get(id, workspaceId) as any;

            if (!result) {
                return { ok: true, value: null };
            }

            return {
                ok: true,
                value: {
                    ...result,
                    metadata: JSON.parse(result.metadata),
                    created_at: new Date(result.created_at),
                    updated_at: new Date(result.updated_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to get memory',
                },
            };
        }
    }

    /**
     * Search memories using vector similarity
     * Uses cosine similarity computed in JavaScript
     */
    async searchMemories(
        workspaceId: string,
        query: SearchQuery
    ): Promise<Result<SearchResult[], any>> {
        try {
            let results: SearchResult[] = [];

            if (query.vector && query.vector.length > 0) {
                // Fetch all memories with embeddings for this workspace
                let sql = 'SELECT * FROM memories WHERE workspace_id = ? AND embedding IS NOT NULL';
                const params: any[] = [workspaceId];

                // Exclude conversational memories (fact.command, fact.response) from search
                // These are user queries/responses and shouldn't crowd out content memories
                sql += ` AND type NOT IN ('fact.command', 'fact.response')`;

                // Apply type filter
                if (query.types && query.types.length > 0) {
                    sql += ` AND type IN (${query.types.map(() => '?').join(',')})`;
                    params.push(...query.types);
                }

                // Apply date filters
                if (query.dateFrom) {
                    sql += ' AND created_at >= ?';
                    params.push(query.dateFrom.toISOString());
                }
                if (query.dateTo) {
                    sql += ' AND created_at <= ?';
                    params.push(query.dateTo.toISOString());
                }

                const memories = this.db.prepare(sql).all(...params) as any[];

                // Compute cosine similarity for each memory
                results = memories
                    .map(memory => {
                        const embedding = JSON.parse(memory.embedding);
                        const score = this.cosineSimilarity(query.vector!, embedding);

                        return {
                            memory: {
                                ...memory,
                                metadata: JSON.parse(memory.metadata),
                                created_at: new Date(memory.created_at),
                                updated_at: new Date(memory.updated_at),
                            },
                            score,
                        };
                    })
                    .sort((a, b) => b.score - a.score)
                    .slice(0, query.limit || 10);
            }
            console.log(`[LocalStorageClient] searchMemories returning ${results.length} results for workspace ${workspaceId}`);
            if (query.text && query.text.trim()) {
                // Text search fallback
                let sql = 'SELECT *, 1.0 as score FROM memories WHERE workspace_id = ? AND content LIKE ?';
                const params: any[] = [workspaceId, `%${query.text.trim()}%`];

                if (query.types && query.types.length > 0) {
                    sql += ` AND type IN (${query.types.map(() => '?').join(',')})`;
                    params.push(...query.types);
                }

                sql += ' ORDER BY created_at DESC LIMIT ?';
                params.push(query.limit || 10);

                const memories = this.db.prepare(sql).all(...params) as any[];

                results = memories.map(memory => ({
                    memory: {
                        ...memory,
                        metadata: JSON.parse(memory.metadata),
                        created_at: new Date(memory.created_at),
                        updated_at: new Date(memory.updated_at),
                    },
                    score: memory.score,
                }));
            }

            return { ok: true, value: results };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to search memories',
                },
            };
        }
    }

    /**
     * Get relationships for a memory
     */
    async getMemoryRelationships(
        memoryId: string,
        workspaceId: string
    ): Promise<Result<Relationship[], any>> {
        try {
            const results = this.db.prepare(`
        SELECT r.* FROM relationships r
        JOIN memories m1 ON r.from_memory_id = m1.id
        JOIN memories m2 ON r.to_memory_id = m2.id
        WHERE (r.from_memory_id = ? OR r.to_memory_id = ?)
        AND m1.workspace_id = ? AND m2.workspace_id = ?
      `).all(memoryId, memoryId, workspaceId, workspaceId) as any[];

            return {
                ok: true,
                value: results.map(r => ({
                    ...r,
                    created_at: new Date(r.created_at),
                })),
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to get relationships',
                },
            };
        }
    }

    /**
     * Create a relationship between memories
     */
    async createRelationship(data: {
        from_memory_id: string;
        to_memory_id: string;
        relationship_type: string;
        confidence: number;
    }): Promise<Result<Relationship, any>> {
        try {
            const id = `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const result = this.db.prepare(`
        INSERT INTO relationships (
          id, from_memory_id, to_memory_id, relationship_type, confidence, created_at
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        RETURNING *
      `).get(
                id,
                data.from_memory_id,
                data.to_memory_id,
                data.relationship_type,
                data.confidence
            ) as any;

            return {
                ok: true,
                value: {
                    ...result,
                    created_at: new Date(result.created_at),
                },
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: 'database' as const,
                    message: error instanceof Error ? error.message : 'Failed to create relationship',
                },
            };
        }
    }

    /**
     * Compute cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same length');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
