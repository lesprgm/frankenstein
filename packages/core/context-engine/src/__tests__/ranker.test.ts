/**
 * Unit tests for MemoryRanker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRanker } from '../ranker';
import type { SearchResult } from '../types';
import type { Memory } from '@memorylayer/storage';

describe('MemoryRanker', () => {
  // Helper function to create test memories
  const createMemory = (
    id: string,
    content: string,
    confidence: number,
    createdAt: Date
  ): Memory => ({
    id,
    workspace_id: 'test-workspace',
    conversation_id: 'test-conversation',
    type: 'fact',
    content,
    confidence,
    metadata: {},
    created_at: createdAt,
    updated_at: createdAt,
  });

  // Helper function to create test search results
  const createSearchResult = (
    id: string,
    score: number,
    confidence: number,
    daysAgo: number
  ): SearchResult => {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgo);
    
    return {
      memory: createMemory(id, `Memory ${id}`, confidence, createdAt),
      score,
    };
  };

  describe('defaultRanking', () => {
    it('should rank by similarity with default weights', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.8, 1),
        createSearchResult('2', 0.9, 0.8, 1),
        createSearchResult('3', 0.7, 0.8, 1),
      ];

      const ranked = MemoryRanker.defaultRanking(results);

      expect(ranked[0].memory.id).toBe('2'); // Highest similarity
      expect(ranked[1].memory.id).toBe('3');
      expect(ranked[2].memory.id).toBe('1'); // Lowest similarity
    });

    it('should combine similarity, recency, and confidence with custom weights', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.9, 10), // Low similarity, high confidence, old
        createSearchResult('2', 0.6, 0.5, 0),  // Medium similarity, medium confidence, very recent
        createSearchResult('3', 0.7, 0.7, 5),  // High similarity, high confidence, medium age
      ];

      const ranked = MemoryRanker.defaultRanking(results, {
        similarityWeight: 0.4,
        recencyWeight: 0.4,
        confidenceWeight: 0.2,
      });

      // Result 2 should rank highest due to recency
      expect(ranked[0].memory.id).toBe('2');
      expect(ranked[0].rank).toBeGreaterThan(0);
    });

    it('should handle equal weights', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.8, 0.8, 1),
        createSearchResult('2', 0.6, 0.6, 1),
      ];

      const ranked = MemoryRanker.defaultRanking(results, {
        similarityWeight: 0.33,
        recencyWeight: 0.33,
        confidenceWeight: 0.34,
      });

      expect(ranked[0].memory.id).toBe('1');
      expect(ranked[1].memory.id).toBe('2');
    });

    it('should handle zero weights', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.9, 1),
        createSearchResult('2', 0.9, 0.5, 1),
      ];

      const ranked = MemoryRanker.defaultRanking(results, {
        similarityWeight: 1.0,
        recencyWeight: 0,
        confidenceWeight: 0,
      });

      expect(ranked[0].memory.id).toBe('2'); // Only similarity matters
    });

    it('should return empty array for empty input', () => {
      const ranked = MemoryRanker.defaultRanking([]);
      expect(ranked).toEqual([]);
    });

    it('should assign rank property to results', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.8, 0.8, 1),
      ];

      const ranked = MemoryRanker.defaultRanking(results);

      expect(ranked[0].rank).toBeDefined();
      expect(typeof ranked[0].rank).toBe('number');
    });
  });

  describe('bySimilarity', () => {
    it('should rank by similarity score only', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.9, 0),
        createSearchResult('2', 0.9, 0.3, 100),
        createSearchResult('3', 0.7, 0.5, 50),
      ];

      const ranked = MemoryRanker.bySimilarity(results);

      expect(ranked[0].memory.id).toBe('2'); // Highest similarity
      expect(ranked[1].memory.id).toBe('3');
      expect(ranked[2].memory.id).toBe('1'); // Lowest similarity
      expect(ranked[0].rank).toBe(0.9);
    });

    it('should return empty array for empty input', () => {
      const ranked = MemoryRanker.bySimilarity([]);
      expect(ranked).toEqual([]);
    });

    it('should assign rank equal to score', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.75, 0.8, 1),
      ];

      const ranked = MemoryRanker.bySimilarity(results);

      expect(ranked[0].rank).toBe(0.75);
    });
  });

  describe('byRecency', () => {
    it('should rank by recency only', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.9, 0.9, 10), // Old
        createSearchResult('2', 0.3, 0.3, 0),  // Very recent
        createSearchResult('3', 0.7, 0.7, 5),  // Medium age
      ];

      const ranked = MemoryRanker.byRecency(results);

      expect(ranked[0].memory.id).toBe('2'); // Most recent
      expect(ranked[1].memory.id).toBe('3');
      expect(ranked[2].memory.id).toBe('1'); // Oldest
    });

    it('should return empty array for empty input', () => {
      const ranked = MemoryRanker.byRecency([]);
      expect(ranked).toEqual([]);
    });

    it('should assign rank based on recency score', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 0), // Today
      ];

      const ranked = MemoryRanker.byRecency(results);

      expect(ranked[0].rank).toBeGreaterThan(0.9); // Very recent should have high score
    });
  });

  describe('byConfidence', () => {
    it('should rank by confidence only', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.9, 0.5, 0),
        createSearchResult('2', 0.3, 0.9, 100),
        createSearchResult('3', 0.7, 0.7, 50),
      ];

      const ranked = MemoryRanker.byConfidence(results);

      expect(ranked[0].memory.id).toBe('2'); // Highest confidence
      expect(ranked[1].memory.id).toBe('3');
      expect(ranked[2].memory.id).toBe('1'); // Lowest confidence
      expect(ranked[0].rank).toBe(0.9);
    });

    it('should return empty array for empty input', () => {
      const ranked = MemoryRanker.byConfidence([]);
      expect(ranked).toEqual([]);
    });

    it('should assign rank equal to confidence', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.85, 1),
      ];

      const ranked = MemoryRanker.byConfidence(results);

      expect(ranked[0].rank).toBe(0.85);
    });
  });

  describe('custom', () => {
    it('should rank using custom score function', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 1),
        createSearchResult('2', 0.9, 0.9, 1),
        createSearchResult('3', 0.7, 0.7, 1),
      ];

      // Custom function: rank by content length
      const ranked = MemoryRanker.custom(results, (result) => {
        return result.memory.content.length;
      });

      expect(ranked.length).toBe(3);
      expect(ranked[0].rank).toBeDefined();
    });

    it('should handle custom function that returns zero', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 1),
      ];

      const ranked = MemoryRanker.custom(results, () => 0);

      expect(ranked[0].rank).toBe(0);
    });

    it('should return empty array for empty input', () => {
      const ranked = MemoryRanker.custom([], () => 1);
      expect(ranked).toEqual([]);
    });

    it('should throw error for non-function scoreFn', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 1),
      ];

      expect(() => {
        MemoryRanker.custom(results, 'not a function' as any);
      }).toThrow('scoreFn must be a function');
    });
  });

  describe('recency score calculation', () => {
    it('should calculate high score for very recent memories', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 0), // Today
      ];

      const ranked = MemoryRanker.byRecency(results);

      // Score should be close to 1 for today (1 / (1 + 0) = 1)
      expect(ranked[0].rank).toBeGreaterThan(0.99);
    });

    it('should calculate lower score for older memories', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 30), // 30 days ago
      ];

      const ranked = MemoryRanker.byRecency(results);

      // Score should be 1 / (1 + 30) ≈ 0.032
      expect(ranked[0].rank).toBeLessThan(0.05);
      expect(ranked[0].rank).toBeGreaterThan(0.03);
    });

    it('should calculate medium score for moderately old memories', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 9), // 9 days ago
      ];

      const ranked = MemoryRanker.byRecency(results);

      // Score should be 1 / (1 + 9) = 0.1
      expect(ranked[0].rank).toBeCloseTo(0.1, 1);
    });

    it('should handle memories from different time periods', () => {
      const results: SearchResult[] = [
        createSearchResult('1', 0.5, 0.5, 0),   // Today
        createSearchResult('2', 0.5, 0.5, 1),   // Yesterday
        createSearchResult('3', 0.5, 0.5, 7),   // Week ago
        createSearchResult('4', 0.5, 0.5, 30),  // Month ago
      ];

      const ranked = MemoryRanker.byRecency(results);

      // Should be ordered by recency
      expect(ranked[0].memory.id).toBe('1');
      expect(ranked[1].memory.id).toBe('2');
      expect(ranked[2].memory.id).toBe('3');
      expect(ranked[3].memory.id).toBe('4');

      // Scores should be decreasing
      expect(ranked[0].rank).toBeGreaterThan(ranked[1].rank);
      expect(ranked[1].rank).toBeGreaterThan(ranked[2].rank);
      expect(ranked[2].rank).toBeGreaterThan(ranked[3].rank);
    });
  });
});
