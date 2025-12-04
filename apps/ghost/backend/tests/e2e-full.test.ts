import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Define test DB path
const TEST_DB_PATH = path.join(process.cwd(), 'test-e2e-full.db');

// Mock services to use the test DB
vi.mock('../src/services/storage.js', async () => {
    const { SQLiteStorage } = await import('../src/services/sqlite-storage.js');
    return {
        storageService: new SQLiteStorage(path.join(process.cwd(), 'test-e2e-full.db')),
    };
});

vi.mock('../src/services/memory-layer-integration.js', async () => {
    const { MemoryLayerIntegration } = await import('../src/services/memory-layer-integration.js');
    return {
        memoryLayerIntegration: new MemoryLayerIntegration(path.join(process.cwd(), 'test-e2e-full.db')),
    };
});

// Mock auth
vi.mock('../src/middleware/auth.js', () => ({
    requireApiKey: async (c: any, next: any) => await next(),
}));

// Import modules AFTER mocks
import { memoryLayerIntegration } from '../src/services/memory-layer-integration.js';
import { storageService } from '../src/services/storage.js';
import { llmCoordinator } from '../src/services/llm-coordinator.js';
import app from '../src/index.js';

describe('Ghost Backend Full E2E (with Context Engine)', () => {
    beforeEach(async () => {
        // Force LLM Coordinator to use fallback logic
        (llmCoordinator as any).hasApi = false;
        (llmCoordinator as any).endpoint = undefined;

        // Initialize MemoryLayer
        await memoryLayerIntegration.initialize();
    });

    afterEach(async () => {
        // Cleanup DB file
        // Note: better-sqlite3 keeps file open, so unlink might fail on Windows, but fine on Mac/Linux usually.
        // To be safe, we could close the DB connection if exposed, but SQLiteStorage doesn't expose close().
        if (fs.existsSync(TEST_DB_PATH)) {
            try {
                fs.unlinkSync(TEST_DB_PATH);
            } catch (e) {
                // Ignore if locked
            }
        }
    });

    it('should index a file and then open it via natural language command', async () => {
        // Use the default workspace ID created by MemoryLayerIntegration
        // Ghost treats userId as workspaceId for simplicity
        const userId = memoryLayerIntegration.getWorkspaceId();
        const filePath = '/Users/test/Documents/project-plan.md';
        const fileContent = 'Project Frankenstein Plan: 1. Build Ghost. 2. Integrate MemoryLayer.';

        // 1. Index a file directly into storage
        const storage = memoryLayerIntegration.storageClient;
        if (!storage) throw new Error('Storage not initialized');

        // Generate embedding
        const embedding = await memoryLayerIntegration.embeddingProvider.embed(fileContent);

        await storage.createMemory({
            workspace_id: userId,
            type: 'entity.file',
            content: fileContent,
            confidence: 1,
            embedding: embedding,
            metadata: {
                path: filePath,
                name: 'project-plan.md',
                modified: new Date().toISOString(),
            },
        });

        // 2. Send a command
        const commandId = `cmd-${Date.now()}-${Math.random()}`;
        const res = await app.request('/api/command', {
            method: 'POST',
            body: JSON.stringify({
                command_id: commandId,
                text: 'Open the project plan',
                user_id: userId,
                timestamp: new Date().toISOString(),
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        if (res.status !== 200) {
            const body = await res.json();
            console.error('Response error:', body);
        }
        expect(res.status).toBe(200);
        const body = await res.json();

        // 3. Verify response
        expect(body.actions).toHaveLength(1);
        expect(body.actions[0]).toEqual({
            type: 'file.open',
            params: {
                path: filePath,
            },
        });
        expect(body.assistant_text.toLowerCase()).toContain('opening the file');
    });

    it('should use LRU cache for repeated queries', async () => {
        const userId = 'user-e2e-cache';
        const query = 'What is the plan?';

        // 1. First request
        await app.request('/api/command', {
            method: 'POST',
            body: JSON.stringify({
                command_id: `cmd-cache-1-${Date.now()}`,
                text: query,
                user_id: userId,
                timestamp: new Date().toISOString(),
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        // 2. Second request
        await app.request('/api/command', {
            method: 'POST',
            body: JSON.stringify({
                command_id: `cmd-cache-2-${Date.now()}`,
                text: query,
                user_id: userId,
                timestamp: new Date().toISOString(),
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        // Verify cache stats
        const engine = memoryLayerIntegration.contextEngine;
        if (engine && 'getCacheStats' in engine) {
            const stats = (engine as any).getCacheStats();
            const totalHits = stats.context.hits + stats.result.hits + stats.embedding.hits;
            expect(totalHits).toBeGreaterThan(0);
        }
    });
});
