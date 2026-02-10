import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { StorageClient, SqliteConfig } from '@memorylayer/storage';
import { initializeDatabase, seedDemoData } from '../db/migrations.js';
import { computeFileFingerprint } from '../utils/file-fingerprint.js';
import type {
    ActionResult,
    Action,
    CommandEntry,
    CommandRequest,
    CommandResponse,
    DashboardData,
    DashboardStats,
    FileIndexRequest,
    FileMetadata,
    MemoryReference,
    Result,
} from '../types.js';

type StoredMemory = MemoryReference & {
    createdAt: string;
    workspace_id: string;
    source: 'command' | 'file' | 'action';
    metadata?: Record<string, any>;
};

const SCORE_FLOOR = 0.3;

/**
 * SQLite-based storage layer for Ghost
 */
export class SQLiteStorage {
    private db: Database.Database;
    public storageClient: StorageClient; // Public for context-engine access
    private lastIndexed: MemoryReference[] = [];

    constructor(dbPath: string = './ghost.db') {
        this.db = initializeDatabase(dbPath);

        this.storageClient = new StorageClient({
            sqlite: {
                filename: dbPath,
            },
            vectorize: {
                mode: 'local', // Use local no-op vector store
            }
        });

        // Seed demo data if database is empty
        const commandCount = this.db.prepare('SELECT COUNT(*) as count FROM commands').get() as { count: number };
        if (commandCount.count === 0) {
            seedDemoData(this.db);
        }

        // Backfill fingerprints so skip-on-unchanged works for existing indexed files
        this.backfillFileFingerprints();
    }

    /**
     * Health indicator for the storage layer
     */
    getHealth(): Result<{ status: 'ok'; mode: 'sqlite'; db: Database.Database }, { type: 'storage_error'; message: string }> {
        if (!this.db) {
            return { ok: false, error: { type: 'storage_error', message: 'Database not initialized' } };
        }
        return { ok: true, value: { status: 'ok', mode: 'sqlite', db: this.db } };
    }

    /**
     * Close the storage connection and cleanup resources
     */
    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
        }
        // Terminate the embedding worker
        const { workerEmbeddingProvider } = await import('../adapters/worker-embedding-provider.js');
        await workerEmbeddingProvider.terminate();
    }

    /**
     * Prune memories based on type and age
     */
    async pruneMemories(rules: { type: string; maxAgeDays: number }[]): Promise<number> {
        let totalDeleted = 0;

        const deleteStmt = this.db.prepare(`
            DELETE FROM memories 
            WHERE type = ? 
            AND created_at < datetime('now', '-' || ? || ' days')
        `);

        const deleteTransaction = this.db.transaction((rulesToProcess) => {
            for (const rule of rulesToProcess) {
                const result = deleteStmt.run(rule.type, rule.maxAgeDays);
                totalDeleted += result.changes;
            }
        });

        try {
            deleteTransaction(rules);
            return totalDeleted;
        } catch (error) {
            console.error('Failed to prune memories:', error);
            throw error;
        }
    }

    /**
     * Save a conversation turn for short-term memory
     */
    async saveConversationTurn(
        userId: string,
        userText: string,
        assistantText: string
    ): Promise<void> {
        const id = crypto.randomUUID();
        const content = `User: ${userText}\nGhost: ${assistantText}`;

        // Ensure user/workspace exists
        await this.ensureUserAndWorkspace(userId);

        const stmt = this.db.prepare(`
            INSERT INTO memories (id, type, content, created_at, workspace_id, metadata)
            VALUES (?, 'fact.conversation', ?, ?, ?, ?)
        `);

        stmt.run(
            id,
            content,
            new Date().toISOString(),
            userId, // workspace_id
            JSON.stringify({ userText, assistantText })
        );
    }

    /**
     * Save a pending action that requires explicit user confirmation.
     */
    async savePendingAction(
        userId: string,
        actions: Action[],
        memoriesUsed: MemoryReference[],
        commandId: string,
        extraMetadata: Record<string, any> = {}
    ): Promise<void> {
        const id = `pending-${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();

        await this.ensureUserAndWorkspace(userId);

        const stmt = this.db.prepare(`
            INSERT INTO memories (id, type, content, created_at, workspace_id, metadata)
            VALUES (?, 'fact.pending_action', ?, ?, ?, ?)
        `);

        const metadata = {
            actions,
            memories_used: memoriesUsed,
            command_id: commandId,
            ...extraMetadata,
        };

        stmt.run(
            id,
            `Pending actions for command ${commandId}`,
            createdAt,
            userId,
            JSON.stringify(metadata)
        );
    }

    /**
     * Retrieve the most recent pending action for a user within a time window.
     */
    getRecentPendingAction(
        userId: string,
        maxAgeMs: number = 2 * 60 * 1000
    ): {
        id: string;
        metadata?: {
            actions?: Action[];
            memories_used?: MemoryReference[];
            choices?: Array<{ action: Action; memories_used?: MemoryReference[]; label?: string }>;
            default_index?: number;
        };
    } | null {
        const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
        const row = this.db.prepare(`
            SELECT id, metadata
            FROM memories
            WHERE workspace_id = ?
              AND type = 'fact.pending_action'
              AND created_at > ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(userId, cutoff) as { id: string; metadata: string | null } | undefined;

        if (!row) return null;
        let metadata: { actions?: Action[]; memories_used?: MemoryReference[] } | undefined;
        if (row.metadata) {
            try {
                metadata = JSON.parse(row.metadata);
            } catch {
                metadata = undefined;
            }
        }
        return { id: row.id, metadata };
    }

    /**
     * Clear a pending action by id.
     */
    async clearPendingAction(id: string): Promise<void> {
        this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    }

    /**
     * Get recent conversation turns for sliding window context
     */
    getRecentConversationTurns(userId: string, limit: number = 5, minutes: number = 10): MemoryReference[] {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

        const stmt = this.db.prepare(`
            SELECT id, type, content, metadata, created_at
            FROM memories
            WHERE workspace_id = ? 
            AND type = 'fact.conversation'
            AND created_at > ?
            ORDER BY created_at ASC
            LIMIT ?
        `);

        const rows = stmt.all(userId, cutoff, limit) as any[];

        return rows.map(row => ({
            id: row.id,
            type: row.type,
            score: 1.0,
            summary: row.content,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        }));
    }

    /**
     * Persist a command + response pair and attach context memories
     */
    async saveCommand(
        request: CommandRequest,
        response: CommandResponse,
        memoriesUsed: MemoryReference[]
    ): Promise<Result<CommandResponse, { type: 'storage_error'; message: string }>> {
        try {
            // Ensure user and workspace exist BEFORE starting the transaction
            await this.ensureUserAndWorkspace(request.user_id);

            const insertCommand = this.db.prepare(`
        INSERT INTO commands (id, text, assistant_text, timestamp, user_id)
        VALUES (?, ?, ?, ?, ?)
      `);

            const insertAction = this.db.prepare(`
        INSERT INTO actions (command_id, type, params, status, executed_at)
        VALUES (?, ?, ?, ?, ?)
      `);

            const insertCommandMemory = this.db.prepare(`
        INSERT OR IGNORE INTO command_memories (command_id, memory_id, score)
        VALUES (?, ?, ?)
      `);

            // Use transaction for atomicity
            const transaction = this.db.transaction(() => {
                // Insert command
                insertCommand.run(
                    request.command_id,
                    request.text,
                    response.assistant_text,
                    request.timestamp,
                    request.user_id
                );

                // Insert actions
                for (const action of response.actions) {
                    insertAction.run(
                        request.command_id,
                        action.type,
                        JSON.stringify(action.params),
                        'success',
                        new Date().toISOString()
                    );
                }

                // Link memories to command
                for (const memory of memoriesUsed) {
                    insertCommandMemory.run(request.command_id, memory.id, memory.score);
                }

                // If screenshot exists, create a memory for it
                if (request.screenshot_path) {
                    const screenshotId = `screen-${request.command_id}`;
                    const screenshotMetadata = {
                        path: request.screenshot_path,
                        commandId: request.command_id,
                        text: request.screen_context
                    };

                    // Insert into memories table
                    const insertMem = this.db.prepare(`
                        INSERT OR IGNORE INTO memories (id, workspace_id, conversation_id, type, content, confidence, metadata, embedding, created_at, updated_at)
                        VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
                    `);

                    insertMem.run(
                        screenshotId,
                        request.user_id,
                        'context.screen',
                        `Screen context for command: ${request.text}`,
                        1.0,
                        JSON.stringify(screenshotMetadata)
                    );

                    // Link to command
                    insertCommandMemory.run(request.command_id, screenshotId, 1.0);
                }
            });

            transaction();

            return { ok: true, value: response };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Store new memories extracted from a conversation
     */
    async addMemories(memories: StoredMemory[]): Promise<void> {
        // Dynamically import to avoid circular dependencies
        const { workerEmbeddingProvider } = await import('../adapters/worker-embedding-provider.js');

        // Determine workspace to write into (default to single-user ghost, otherwise first memory's workspace)
        const workspaceId = memories[0]?.workspace_id || process.env.GHOST_WORKSPACE_ID || 'ghost';
        await this.ensureUserAndWorkspace(workspaceId);
        const collectionMemoryId = this.ensureCollectionMemory(workspaceId);

        // 1. Generate all embeddings first (parallelized)
        // Note: workerEmbeddingProvider is off-thread, so Promise.all schedules them on the worker
        // If using an API, this would need rate limiting (e.g. p-limit)
        const memoriesWithEmbeddings = await Promise.all(
            memories.map(async (mem) => {
                const embedding = await workerEmbeddingProvider.embed(mem.summary);
                return { ...mem, embedding };
            })
        );

        const insertMem = this.db.prepare(`
      INSERT OR IGNORE INTO memories (id, workspace_id, conversation_id, type, content, confidence, metadata, embedding, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
        const updateMem = this.db.prepare(`
      UPDATE memories
      SET content = ?, confidence = ?, metadata = ?, embedding = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

        // 2. Execute writes in a single transaction
        const transaction = this.db.transaction((items: typeof memoriesWithEmbeddings) => {
            for (const mem of items) {
                const metadataJson = JSON.stringify(mem.metadata || {});
                const embeddingJson = JSON.stringify(mem.embedding);

                // Upsert memory with embedding
                insertMem.run(
                    mem.id,
                    workspaceId,
                    mem.type,
                    mem.summary,
                    mem.score,
                    metadataJson,
                    embeddingJson
                );
                updateMem.run(mem.summary, mem.score, metadataJson, embeddingJson, mem.id);

                // Create a simple relationship from the collection root to each memory
                try {
                    const relConfidence = Math.max(0, Math.min(1, mem.score ?? 0.8));
                    this.insertRelationship(collectionMemoryId, mem.id, 'contains', relConfidence);
                } catch (error) {
                    console.warn('Failed to create relationship (skipping)', { from: collectionMemoryId, to: mem.id, error });
                }
            }
        });

        transaction(memoriesWithEmbeddings);
    }

    /**
     * Ensure a synthetic "collection" memory exists for grouping file memories.
     */
    private ensureCollectionMemory(workspaceId: string): string {
        const collectionId = `collection-files-${workspaceId}`;
        const exists = this.db
            .prepare('SELECT 1 FROM memories WHERE id = ?')
            .get(collectionId) as { 1?: number } | undefined;
        if (!exists) {
            this.db
                .prepare(
                    `INSERT INTO memories (id, workspace_id, conversation_id, type, content, confidence, metadata, embedding, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))`
                )
                .run(
                    collectionId,
                    workspaceId,
                    'entity.collection',
                    `Files for workspace ${workspaceId}`,
                    1,
                    JSON.stringify({ scope: 'files', workspace: workspaceId })
                );
        }
        return collectionId;
    }

    private insertRelationship(fromId: string, toId: string, type: string, confidence: number): void {
        try {
            this.db
                .prepare(
                    `INSERT OR IGNORE INTO relationships (id, from_memory_id, to_memory_id, relationship_type, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
                )
                .run(
                    `rel-${crypto.randomUUID()}`,
                    fromId,
                    toId,
                    type,
                    confidence
                );
        } catch (error) {
            console.warn('Relationship insert failed', { fromId, toId, type, error });
        }
    }

    /**
     * Get related memories by traversing relationships
     * @param memoryId - Starting memory ID
     * @param depth - How many relationship hops to traverse (default: 1)
     * @param relationshipTypes - Filter by specific relationship types (optional)
     * @returns Array of related memory references
     */
    getRelatedMemories(
        memoryId: string,
        depth: number = 1,
        relationshipTypes?: string[]
    ): MemoryReference[] {
        if (depth < 1) return [];

        const visited = new Set<string>();
        const results: MemoryReference[] = [];

        const traverse = (currentId: string, currentDepth: number) => {
            if (currentDepth > depth || visited.has(currentId)) return;
            visited.add(currentId);

            // Build relationship type filter
            const typeFilter = relationshipTypes && relationshipTypes.length > 0
                ? `AND r.relationship_type IN (${relationshipTypes.map(() => '?').join(',')})`
                : '';

            // Query for related memories (both directions)
            const query = `
                SELECT DISTINCT m.id, m.summary as content, m.created_at as timestamp, m.metadata
                FROM memories m
                INNER JOIN relationships r ON (r.from_memory_id = ? AND r.to_memory_id = m.id)
                                           OR (r.to_memory_id = ? AND r.from_memory_id = m.id)
                WHERE 1=1 ${typeFilter}
            `;

            const params = [currentId, currentId, ...(relationshipTypes || [])];
            const rows = this.db.prepare(query).all(...params) as Array<{
                id: string;
                content: string;
                timestamp: string;
                metadata: string;
            }>;

            for (const row of rows) {
                if (!visited.has(row.id)) {
                    results.push({
                        id: row.id,
                        type: 'file', // Default type, could be enhanced based on metadata
                        score: 1.0, // Default score for related items
                        summary: row.content,
                        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
                    });

                    // Recursively traverse if we haven't reached max depth
                    if (currentDepth < depth) {
                        traverse(row.id, currentDepth + 1);
                    }
                }
            }
        };

        traverse(memoryId, 1);
        return results;
    }



    /**
     * Creates a default user/workspace pair if missing to satisfy FK constraints.
     */
    private async ensureUserAndWorkspace(workspaceId: string): Promise<void> {
        // For Ghost's simple model, workspace_id == user_id
        const userId = workspaceId;

        this.db
            .prepare(
                `INSERT OR IGNORE INTO users (id, email, name, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`
            )
            .run(userId, `${userId}@local`, `User ${userId}`);

        this.db
            .prepare(
                `INSERT OR IGNORE INTO workspaces (id, name, type, owner_id, created_at, updated_at)
         VALUES (?, ?, 'personal', ?, datetime('now'), datetime('now'))`
            )
            .run(workspaceId, `Workspace ${workspaceId}`, userId);
    }

    /**
     * Simple semantic-ish search over stored memories
     */
    async searchMemories(
        queryText: string,
        userId: string,
        limit: number = 8
    ): Promise<Result<Array<{ memory: StoredMemory; score: number }>, { type: 'storage_error'; message: string }>> {
        // Dynamically import to avoid circular dependencies
        const { workerEmbeddingProvider } = await import('../adapters/worker-embedding-provider.js');
        const embedding = await workerEmbeddingProvider.embed(queryText);

        const result = await this.storageClient.searchMemories(userId, {
            text: queryText,
            vector: embedding,
            limit: limit,
        });

        let scored: Array<{ memory: StoredMemory; score: number }> = [];

        if (result.ok) {
            scored = result.value.map(item => ({
                memory: {
                    id: item.memory.id,
                    type: item.memory.type,
                    score: item.memory.confidence,
                    summary: item.memory.content,
                    workspace_id: item.memory.workspace_id,
                    source: 'command',
                    metadata: item.memory.metadata,
                    createdAt: item.memory.created_at.toISOString(),
                } as StoredMemory,
                score: item.score
            }));
        }

        // Fallback: If we have few results, try a simple text search
        if (scored.length < limit) {
            try {
                const terms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);
                if (terms.length > 0) {
                    // Simple LIKE query for each term
                    const likeClauses = terms.map(() => `lower(content) LIKE ?`).join(' OR ');
                    const params = terms.map(t => `%${t}%`);

                    const rows = this.db.prepare(`
                        SELECT id, type, confidence as score, content as summary, metadata, created_at, workspace_id
                        FROM memories
                        WHERE workspace_id = ? AND (${likeClauses})
                        LIMIT ?
                    `).all(userId, ...params, limit) as any[];

                    for (const row of rows) {
                        if (!scored.find(s => s.memory.id === row.id)) {
                            // Use original memory confidence, not hardcoded 0.5
                            const memoryScore = row.score || 0.5;
                            scored.push({
                                memory: {
                                    id: row.id,
                                    type: row.type,
                                    score: memoryScore,
                                    summary: row.summary,
                                    workspace_id: row.workspace_id,
                                    source: 'command',
                                    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
                                    createdAt: row.created_at,
                                } as StoredMemory,
                                score: memoryScore // Use original score for ranking
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn('Text search fallback failed', err);
            }
        }

        // Sort by score
        scored.sort((a, b) => b.score - a.score);

        return { ok: true, value: scored.slice(0, limit) };
    }

    /**
     * Index a batch of files as entity memories
     */
    async indexFiles(
        payload: FileIndexRequest
    ): Promise<Result<{ indexed: number; memories: MemoryReference[] }, { type: 'storage_error'; message: string }>> {
        try {
            const memories = payload.files.map((file) => this.buildFileMemory(file, payload.user_id));

            await this.addMemories(
                memories.map((mem) => ({
                    ...mem,
                    workspace_id: payload.user_id,
                    createdAt: new Date().toISOString(),
                    source: 'file' as const,
                }))
            );

            this.lastIndexed = memories;

            return { ok: true, value: { indexed: memories.length, memories } };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Return most recent file memories for a user (best-effort fallback)
     */
    getRecentFiles(
        userId: string,
        limit: number = 6
    ): Result<MemoryReference[], { type: 'storage_error'; message: string }> {
        try {
            if (this.lastIndexed.length > 0) {
                return { ok: true, value: this.lastIndexed.slice(0, limit) };
            }

            const rows = this.db
                .prepare(
                    `SELECT id, type, confidence as score, content as summary, metadata
           FROM memories
           WHERE workspace_id = ? AND type = 'entity.file'
           ORDER BY created_at DESC
           LIMIT ?`
                )
                .all(userId, limit) as Array<{
                    id: string;
                    type: string;
                    score: number;
                    summary: string;
                    metadata: string | null;
                }>;

            const memories = rows.map((row) => ({
                id: row.id,
                type: row.type,
                score: row.score,
                summary: row.summary,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            }));

            return { ok: true, value: memories };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Simple text search fallback over memory content (non-file memories).
     */
    searchMemoriesText(
        queryText: string,
        userId: string,
        limit: number = 5
    ): Result<MemoryReference[], { type: 'storage_error'; message: string }> {
        try {
            const terms = queryText.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
            if (terms.length === 0) {
                return { ok: true, value: [] };
            }
            // Use OR so any matching term will surface the memory
            const likeClauses = terms.map(() => `lower(content) LIKE ?`).join(' OR ');
            const params = terms.map((t) => `%${t}%`);

            const rows = this.db
                .prepare(
                    `SELECT id, type, confidence as score, content as summary, metadata
                     FROM memories
                     WHERE workspace_id = ? AND type NOT LIKE 'entity.file%' AND type != 'fact.pending_action' AND ${likeClauses}
                     ORDER BY confidence DESC, created_at DESC
                     LIMIT ?`
                )
                .all(userId, ...params, limit) as Array<{
                    id: string;
                    type: string;
                    score: number;
                    summary: string;
                    metadata: string | null;
                }>;

            const memories = rows.map((row) => ({
                id: row.id,
                type: row.type,
                score: row.score,
                summary: row.summary,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            }));

            return { ok: true, value: memories };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Return recent non-screen, non-file memories as a last-resort recall.
     */
    getRecentNonScreenMemories(
        userId: string,
        limit: number = 3
    ): Result<MemoryReference[], { type: 'storage_error'; message: string }> {
        try {
            const rows = this.db
                .prepare(
                    `SELECT id, type, confidence as score, content as summary, metadata
                     FROM memories
                     WHERE workspace_id = ?
                       AND type NOT LIKE 'entity.file%'
                       AND type NOT LIKE 'context.screen%'
                       AND type != 'fact.pending_action'
                     ORDER BY created_at DESC
                     LIMIT ?`
                )
                .all(userId, limit) as Array<{
                    id: string;
                    type: string;
                    score: number;
                    summary: string;
                    metadata: string | null;
                }>;

            const memories = rows.map((row) => ({
                id: row.id,
                type: row.type,
                score: row.score,
                summary: row.summary,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            }));

            return { ok: true, value: memories };
        } catch (error) {
            return {
                ok: false,
                error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Return dashboard payload with commands and aggregate stats
     */
    getDashboardData(limit: number = 50): DashboardData {
        const commandRows = this.db
            .prepare(
                `SELECT id, text, assistant_text, timestamp
         FROM commands
         ORDER BY timestamp DESC
         LIMIT ?`
            )
            .all(limit) as Array<{
                id: string;
                text: string;
                assistant_text: string;
                timestamp: string;
            }>;

        if (commandRows.length === 0) {
            return { commands: [], stats: this.getStats() };
        }

        const commandIds = commandRows.map(c => c.id);
        const placeholders = commandIds.map(() => '?').join(',');

        // Fetch actions for all these commands
        const allActions = this.db.prepare(`
            SELECT command_id, type, params, status, executed_at
            FROM actions
            WHERE command_id IN (${placeholders})
        `).all(...commandIds) as Array<{
            command_id: string;
            type: string;
            params: string;
            status: string;
            executed_at: string;
        }>;

        // Group actions by command_id
        const actionsByCommand = new Map<string, ActionResult[]>();
        for (const a of allActions) {
            if (!actionsByCommand.has(a.command_id)) {
                actionsByCommand.set(a.command_id, []);
            }
            actionsByCommand.get(a.command_id)!.push({
                action: {
                    type: a.type as any,
                    params: JSON.parse(a.params),
                },
                status: a.status as any,
                executedAt: a.executed_at,
            });
        }

        // Fetch memories used for all these commands
        const allMemories = this.db.prepare(`
            SELECT cm.command_id, m.id, m.type, m.confidence as score, m.content as summary, m.metadata
            FROM command_memories cm
            JOIN memories m ON cm.memory_id = m.id
            WHERE cm.command_id IN (${placeholders})
        `).all(...commandIds) as Array<{
            command_id: string;
            id: string;
            type: string;
            score: number;
            summary: string;
            metadata: string | null;
        }>;

        // Group memories by command_id
        const memoriesByCommand = new Map<string, MemoryReference[]>();
        for (const m of allMemories) {
            if (!memoriesByCommand.has(m.command_id)) {
                memoriesByCommand.set(m.command_id, []);
            }
            memoriesByCommand.get(m.command_id)!.push({
                id: m.id,
                type: m.type as any,
                score: m.score,
                summary: m.summary,
                metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
            });
        }

        const commands: CommandEntry[] = commandRows.map((row) => ({
            id: row.id,
            text: row.text,
            assistant_text: row.assistant_text,
            timestamp: row.timestamp,
            actions: actionsByCommand.get(row.id) || [],
            memories_used: memoriesByCommand.get(row.id) || [],
        }));

        return {
            commands,
            stats: this.getStats(),
        };
    }

    /**
     * Compute dashboard statistics
     */
    getStats(): DashboardStats {
        const totalCommands = (this.db.prepare('SELECT COUNT(*) as count FROM commands').get() as { count: number }).count;
        const totalMemories = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;

        const successActions = (
            this.db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'success'").get() as { count: number }
        ).count;
        const totalActions = (this.db.prepare('SELECT COUNT(*) as count FROM actions').get() as { count: number }).count;

        const successRate = totalActions === 0 ? 1 : successActions / totalActions;

        return {
            totalCommands,
            totalMemories,
            successRate: Math.round(successRate * 100) / 100,
        };
    }

    /**
     * Build a memory object for a file index entry
     */
    private buildFileMemory(file: FileMetadata, userId: string): MemoryReference {
        const fingerprint = computeFileFingerprint(file.path, file.size, file.modified);
        return {
            id: `file-${crypto.createHash('md5').update(file.path).digest('hex')}`,
            type: 'entity.file',
            score: 0.3, // Low score for metadata-only; content ingestion will create higher-scored fact memories
            summary: `${file.name} (modified ${file.modified}) @ ${file.path}`,
            metadata: {
                path: file.path,
                name: file.name,
                modified: file.modified,
                size: file.size,
                userId,
                fingerprint,
            },
        };
    }

    /**
     * Find file memories by matching name/path/content for open/view intents.
     */
    async findFileByNameOrPath(
        queryText: string,
        workspaceId: string,
        limit: number = 3
    ): Promise<MemoryReference[]> {
        const safeQuery = queryText.replace(/[%_]/g, ''); // basic LIKE escaping
        const like = `%${safeQuery}%`;

        const rows = this.db
            .prepare(
                `
        SELECT * FROM memories
        WHERE workspace_id = ?
          AND type = 'entity.file'
          AND (
            content LIKE @like OR
            metadata LIKE @like
          )
        ORDER BY created_at DESC
        LIMIT @limit
        `
            )
            .all(workspaceId, { like, limit }) as any[];

        return rows.map((row) => ({
            id: row.id,
            type: row.type,
            score: row.confidence,
            summary: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        }));
    }

    /**
     * Check whether a file is unchanged based on stored fingerprint/metadata.
     * If metadata exists and matches (but lacks fingerprint), backfill fingerprint.
     */
    async isFileUnchanged(file: FileMetadata, workspaceId: string): Promise<boolean> {
        const fingerprint = computeFileFingerprint(file.path, file.size, file.modified);
        const fileId = `file-${crypto.createHash('md5').update(file.path).digest('hex')}`;
        const row = this.db
            .prepare(
                `SELECT metadata FROM memories WHERE id = ? AND workspace_id = ? AND type = 'entity.file'`
            )
            .get(fileId, workspaceId) as any;

        if (!row) return false;

        let metadata: any;
        try {
            metadata = JSON.parse(row.metadata);
        } catch {
            return false;
        }

        // If fingerprint matches, unchanged.
        if (metadata?.fingerprint === fingerprint) {
            return true;
        }

        // If size/modified match, backfill fingerprint and treat as unchanged.
        const sameSize = metadata?.size === file.size;
        const sameModified = metadata?.modified === file.modified;
        if (sameSize && sameModified) {
            metadata.fingerprint = fingerprint;
            this.db
                .prepare(`UPDATE memories SET metadata = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`)
                .run(JSON.stringify(metadata), fileId, workspaceId);
            return true;
        }

        return false;
    }

    /**
     * Backfill fingerprints for existing file memories lacking one.
     */
    backfillFileFingerprints(): void {
        const rows = this.db
            .prepare(`SELECT id, metadata, workspace_id FROM memories WHERE type = 'entity.file'`)
            .all() as any[];

        const updateStmt = this.db.prepare(
            `UPDATE memories SET metadata = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`
        );

        for (const row of rows) {
            let metadata: any;
            try {
                metadata = JSON.parse(row.metadata);
            } catch {
                continue;
            }
            if (metadata?.fingerprint) continue;

            const fingerprint = computeFileFingerprint(metadata?.path, metadata?.size, metadata?.modified);
            if (!fingerprint) continue;

            metadata.fingerprint = fingerprint;
            updateStmt.run(JSON.stringify(metadata), row.id, row.workspace_id);
        }
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}

/**
 * Normalize text for crude similarity scoring
 */
function normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
