/**
 * Demo of LRU caching performance improvements
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingCache, ResultCache, ContextCache } from '../embeddings/cache';

describe('Cache Performance Demo', () => {
    it('should demonstrate embedding cache performance', () => {
        const cache = new EmbeddingCache();
        const query = 'What is the meaning of life?';
        const model = 'test-model';

        // First access - cache miss
        const key = cache.generateKey(query, model);
        expect(cache.get(key)).toBeUndefined();

        // Simulate embedding generation (expensive operation)
        const embedding = new Array(384).fill(0).map(() => Math.random());
        cache.set(key, embedding);

        // Second access - cache hit (instant)
        const cachedEmbedding = cache.get(key);
        expect(cachedEmbedding).toEqual(embedding);

        // Check stats
        const stats = cache.getStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(cache.getHitRate()).toBe(0.5); // 1 hit, 1 miss = 50%
    });

    it('should demonstrate context cache key generation', () => {
        const cache = new ContextCache();

        // Same query params should generate same key
        const key1 = cache.generateKey({
            query: 'test',
            workspaceId: 'ws-1',
            limit: 10,
            tokenBudget: 1000,
        });

        const key2 = cache.generateKey({
            query: 'test',
            workspaceId: 'ws-1',
            limit: 10,
            tokenBudget: 1000,
        });

        expect(key1).toBe(key2);

        // Different query should generate different key
        const key3 = cache.generateKey({
            query: 'different',
            workspaceId: 'ws-1',
            limit: 10,
            tokenBudget: 1000,
        });

        expect(key1).not.toBe(key3);
    });

    it('should demonstrate result cache', () => {
        const cache = new ResultCache();

        const searchParams = {
            query: 'test query',
            workspaceId: 'ws-1',
            limit: 10,
        };

        const key = cache.generateKey(searchParams);

        // Mock search results
        const results = [
            {
                memory: {
                    id: 'mem-1',
                    workspace_id: 'ws-1',
                    conversation_id: null,
                    type: 'entity',
                    content: 'Test memory',
                    confidence: 0.9,
                    metadata: {},
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                score: 0.85,
            },
        ];

        // Cache the results
        cache.set(key, results);

        // Retrieve from cache
        const cached = cache.get(key);
        expect(cached).toEqual(results);

        // Check hit rate
        expect(cache.getHitRate()).toBe(1.0); // 100% hit rate
    });

    it('should demonstrate LRU eviction', () => {
        const cache = new EmbeddingCache({ maxSize: 3 });

        // Fill cache to max
        for (let i = 0; i < 3; i++) {
            const key = cache.generateKey(`query-${i}`, 'model');
            cache.set(key, [i]);
        }

        expect(cache.size).toBe(3);

        // Add one more - oldest should be evicted
        const newKey = cache.generateKey('query-3', 'model');
        cache.set(newKey, [3]);

        expect(cache.size).toBe(3); // Still at max

        // First key should be evicted
        const firstKey = cache.generateKey('query-0', 'model');
        expect(cache.get(firstKey)).toBeUndefined();
    });
});
