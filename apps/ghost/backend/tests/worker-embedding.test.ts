import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { WorkerEmbeddingProvider } from '../src/adapters/worker-embedding-provider';

// Helper for cosine similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magA * magB);
}

describe('WorkerEmbeddingProvider', () => {
    let provider: WorkerEmbeddingProvider;

    beforeAll(async () => {
        provider = new WorkerEmbeddingProvider();
        // Warm up / ensure worker is ready
        await provider.embed('warmup');
    });

    afterAll(async () => {
        await provider.terminate();
    });

    it('should generate embeddings with correct dimensions (384)', async () => {
        const text = 'Test embedding generation';
        const embedding = await provider.embed(text);

        expect(embedding).toBeDefined();
        expect(embedding.length).toBe(384);
        expect(embedding.every(n => typeof n === 'number')).toBe(true);
    });

    it('should generate consistent embeddings for same text', async () => {
        const text = 'Consistent embedding test';
        const embedding1 = await provider.embed(text);
        const embedding2 = await provider.embed(text);

        const similarity = cosineSimilarity(embedding1, embedding2);
        expect(similarity).toBeGreaterThan(0.999);
    });

    it('should generate different embeddings for different text', async () => {
        const text1 = 'The quick brown fox jumps over the lazy dog';
        const text2 = 'Lorem ipsum dolor sit amet';

        const embedding1 = await provider.embed(text1);
        const embedding2 = await provider.embed(text2);

        const similarity = cosineSimilarity(embedding1, embedding2);
        expect(similarity).toBeLessThan(0.5);
    });

    it('should handle batch embeddings correctly', async () => {
        const texts = ['Text 1', 'Text 2', 'Text 3'];
        const embeddings = await provider.embedBatch(texts);

        expect(embeddings.length).toBe(3);
        embeddings.forEach(emb => {
            expect(emb.length).toBe(384);
        });

        // Verify order is preserved by checking individual embeddings
        const singleEmb0 = await provider.embed(texts[0]);
        expect(cosineSimilarity(embeddings[0], singleEmb0)).toBeGreaterThan(0.999);
    });

    it('should handle concurrent requests', async () => {
        const texts = Array.from({ length: 10 }, (_, i) => `Concurrent request ${i}`);
        
        const promises = texts.map(text => provider.embed(text));
        const results = await Promise.all(promises);

        expect(results.length).toBe(10);
        results.forEach(emb => {
            expect(emb.length).toBe(384);
        });
    });

    it('should recover from errors (optional - if implemented)', async () => {
        // This is a placeholder. If we had a way to force a worker error, we'd test recovery here.
        // For now, just ensuring normal operation continues after stress is good.
        const result = await provider.embed('Post-stress check');
        expect(result.length).toBe(384);
    });
});
