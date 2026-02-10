import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryLayerIntegration } from '../src/services/memory-layer-integration';
import { WorkerEmbeddingProvider } from '../src/adapters/worker-embedding-provider';

describe('MemoryLayerIntegration', () => {
    let memoryLayer: MemoryLayerIntegration;

    beforeAll(async () => {
        // Use in-memory DB for testing
        memoryLayer = new MemoryLayerIntegration(':memory:');
        await memoryLayer.initialize();
    });

    afterAll(async () => {
        // Cleanup worker
        await memoryLayer.close();
    });

    it('should initialize all components', () => {
        expect(memoryLayer.storageClient).toBeDefined();
        expect(memoryLayer.embeddingProvider).toBeDefined();
        expect(memoryLayer.singleUserManager).toBeDefined();
        expect(memoryLayer.contextEngine).toBeDefined();
        expect(memoryLayer.memoryExtractor).toBeDefined();
        expect(memoryLayer.chatCapture).toBeDefined();
    });

    it('should use WorkerEmbeddingProvider', () => {
        expect(memoryLayer.embeddingProvider).toBeInstanceOf(WorkerEmbeddingProvider);
    });

    it('should have a valid workspace ID', () => {
        const workspaceId = memoryLayer.getWorkspaceId();
        expect(workspaceId).toBeDefined();
        expect(typeof workspaceId).toBe('string');
        expect(workspaceId.length).toBeGreaterThan(0);
    });

    it('should be able to generate embeddings via the provider', async () => {
        const text = 'Integration test embedding';
        const embedding = await memoryLayer.embeddingProvider.embed(text);
        expect(embedding).toBeDefined();
        expect(embedding.length).toBe(384);
    });

    // Add more integration tests here as needed
    // For example, testing context retrieval if we had data
});
