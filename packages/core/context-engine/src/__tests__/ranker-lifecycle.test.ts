import { describe, it, expect } from 'vitest';
import { MemoryRanker } from '../ranker';
import { SearchResult } from '../types';
import { Memory } from '@memorylayer/storage';

describe('MemoryRanker Lifecycle Integration', () => {
    const baseMemory: Memory = {
        id: '1',
        workspace_id: 'ws1',
        conversation_id: null,
        type: 'fact',
        content: 'test',
        confidence: 1.0,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        lifecycle_state: 'active',
        last_accessed_at: new Date(),
        access_count: 0,
        importance_score: 0.5,
        decay_score: 1.0,
        effective_ttl: null,
        pinned: false,
    };

    it('should rank fresher memories higher (higher decay score)', () => {
        const freshMemory: SearchResult = {
            memory: { ...baseMemory, id: 'fresh', decay_score: 1.0 },
            score: 0.9,
        };

        const decayedMemory: SearchResult = {
            memory: { ...baseMemory, id: 'decayed', decay_score: 0.1 },
            score: 0.9, // Same similarity
        };

        const results = MemoryRanker.defaultRanking([decayedMemory, freshMemory], {
            similarityWeight: 0.4,
            recencyWeight: 0, // Ignore recency for this test
            confidenceWeight: 0, // Ignore confidence
            decayWeight: 0.6,
        });

        expect(results[0].memory.id).toBe('fresh');
        expect(results[1].memory.id).toBe('decayed');
        expect(results[0].rank).toBeGreaterThan(results[1].rank!);
    });

    it('should boost pinned memories (decay score 1.0)', () => {
        const pinnedMemory: SearchResult = {
            memory: { ...baseMemory, id: 'pinned', decay_score: 1.0, pinned: true },
            score: 0.8,
        };

        const decayedMemory: SearchResult = {
            memory: { ...baseMemory, id: 'decayed', decay_score: 0.5, pinned: false },
            score: 0.8,
        };

        const results = MemoryRanker.defaultRanking([decayedMemory, pinnedMemory], {
            similarityWeight: 0.4,
            recencyWeight: 0,
            confidenceWeight: 0,
            decayWeight: 0.6,
        });

        expect(results[0].memory.id).toBe('pinned');
    });

    it('should default missing decay score to 1.0', () => {
        const noDecayMemory: SearchResult = {
            memory: { ...baseMemory, id: 'no-decay', decay_score: undefined as any },
            score: 0.9,
        };

        const results = MemoryRanker.defaultRanking([noDecayMemory], {
            decayWeight: 0.5,
            similarityWeight: 0,
            recencyWeight: 0,
            confidenceWeight: 0,
        });

        // Should be treated as 1.0 * 0.5 = 0.5
        expect(results[0].rank).toBe(0.5);
    });

    it('should respect custom decay weight', () => {
        const memory: SearchResult = {
            memory: { ...baseMemory, decay_score: 0.5 },
            score: 0,
        };

        const results = MemoryRanker.defaultRanking([memory], {
            decayWeight: 1.0,
            similarityWeight: 0,
            recencyWeight: 0,
            confidenceWeight: 0,
        });

        expect(results[0].rank).toBe(0.5); // 0.5 * 1.0
    });
});
