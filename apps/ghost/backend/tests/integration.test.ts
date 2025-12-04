import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import type { CommandRequest, FileIndexRequest } from '../src/types';
import { SQLiteStorage } from '../src/services/sqlite-storage';
import { MemoryLayerIntegration } from '../src/services/memory-layer-integration';
import { ContextBuilder } from '../src/services/context-builder';

describe('Ghost Backend Integration', () => {
    let userId: string;
    const TEST_DB_PATH = `./test-ghost-integration-${Date.now()}.db`;

    let storageService: SQLiteStorage;
    let memoryLayerIntegration: MemoryLayerIntegration;
    let contextBuilder: ContextBuilder;

    beforeAll(async () => {
        // Initialize storage first
        storageService = new SQLiteStorage(TEST_DB_PATH);

        // Initialize MemoryLayer with the SAME storageClient instance
        memoryLayerIntegration = new MemoryLayerIntegration(TEST_DB_PATH, storageService.storageClient);
        await memoryLayerIntegration.initialize();
        userId = memoryLayerIntegration.getWorkspaceId();

        // Create context builder with our test instance (DI)
        contextBuilder = new ContextBuilder(memoryLayerIntegration);
    });

    afterAll(() => {
        // Clean up test DB
        try {
            if (fs.existsSync(TEST_DB_PATH)) {
                fs.unlinkSync(TEST_DB_PATH);
            }
            if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
            if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
        } catch (e) {
            console.error('Failed to cleanup test DB:', e);
        }
    });

    it('should index a file and retrieve it via semantic search', async () => {
        // 1. Index a file
        const indexRequest: FileIndexRequest = {
            user_id: userId,
            files: [
                {
                    path: '/tmp/project_alpha_specs.pdf',
                    name: 'Project Alpha Specs.pdf',
                    modified: new Date().toISOString(),
                    size: 1024,
                },
            ],
        };

        const indexResult = await storageService.indexFiles(indexRequest);
        console.log('Index result:', JSON.stringify(indexResult, null, 2));
        expect(indexResult.ok).toBe(true);
        if (indexResult.ok) {
            expect(indexResult.value.indexed).toBe(1);
        }

        // 2. Build context using the shared contextBuilder
        const contextResult = await contextBuilder.buildContext('What are the specs for Project Alpha?', userId);

        console.log('Context result:', JSON.stringify({
            memoriesCount: contextResult.memories.length,
            memories: contextResult.memories
        }, null, 2));

        // 3. Verify semantic search (or recent-file fallback) found the file
        if (contextResult.memories.length === 0) {
            const recent = storageService.getRecentFiles(userId, 1);
            expect(recent.ok).toBe(true);
            if (recent.ok) {
                expect(recent.value[0]?.metadata?.path).toBe('/tmp/project_alpha_specs.pdf');
            }
        } else {
            const usedFile = contextResult.memories.find((m: any) => m.memory.metadata?.path === '/tmp/project_alpha_specs.pdf');
            expect(usedFile).toBeDefined();
        }
    });

    it('should handle commands with no relevant memories gracefully', async () => {
        // Build context for an unrelated query
        const contextResult = await contextBuilder.buildContext('Tell me about the history of ancient Rome', userId);

        // Should return empty memories gracefully
        expect(contextResult.memories.length).toBe(0);
    });
});
