/**
 * Unit tests for EmbeddingCache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingCache } from '../embeddings/cache';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache();
  });

  describe('Cache Hit and Miss', () => {
    it('should return undefined for cache miss', () => {
      const key = cache.generateKey('test query', 'test-model');
      const result = cache.get(key);
      expect(result).toBeUndefined();
    });

    it('should return embedding for cache hit', () => {
      const key = cache.generateKey('test query', 'test-model');
      const embedding = [0.1, 0.2, 0.3];
      
      cache.set(key, embedding);
      const result = cache.get(key);
      
      expect(result).toEqual(embedding);
    });

    it('should handle multiple cache entries', () => {
      const key1 = cache.generateKey('query 1', 'model-1');
      const key2 = cache.generateKey('query 2', 'model-2');
      const embedding1 = [0.1, 0.2];
      const embedding2 = [0.3, 0.4];
      
      cache.set(key1, embedding1);
      cache.set(key2, embedding2);
      
      expect(cache.get(key1)).toEqual(embedding1);
      expect(cache.get(key2)).toEqual(embedding2);
    });

    it('should return undefined for empty key', () => {
      const result = cache.get('');
      expect(result).toBeUndefined();
    });

    it('should ignore invalid set operations', () => {
      cache.set('', [0.1, 0.2]);
      cache.set('key', []);
      cache.set('key', null as any);
      cache.set('key', 'not an array' as any);
      
      expect(cache.size).toBe(0);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent keys for same input', () => {
      const key1 = cache.generateKey('test query', 'test-model');
      const key2 = cache.generateKey('test query', 'test-model');
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different queries', () => {
      const key1 = cache.generateKey('query 1', 'test-model');
      const key2 = cache.generateKey('query 2', 'test-model');
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different models', () => {
      const key1 = cache.generateKey('test query', 'model-1');
      const key2 = cache.generateKey('test query', 'model-2');
      
      expect(key1).not.toBe(key2);
    });

    it('should include model name in key format', () => {
      const key = cache.generateKey('test query', 'gpt-4');
      expect(key).toContain('gpt-4:');
    });

    it('should throw error for empty text', () => {
      expect(() => {
        cache.generateKey('', 'test-model');
      }).toThrow('Text and model are required');
    });

    it('should throw error for empty model', () => {
      expect(() => {
        cache.generateKey('test query', '');
      }).toThrow('Text and model are required');
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', () => {
      const shortTTLCache = new EmbeddingCache({ ttl: 1 }); // 1 second
      const key = shortTTLCache.generateKey('test query', 'test-model');
      const embedding = [0.1, 0.2, 0.3];
      
      shortTTLCache.set(key, embedding);
      
      // Should be available immediately
      expect(shortTTLCache.get(key)).toEqual(embedding);
      
      // Wait for TTL to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100); // 1.1 seconds
      
      // Should be expired
      expect(shortTTLCache.get(key)).toBeUndefined();
      
      vi.useRealTimers();
    });

    it('should not expire entries before TTL', () => {
      const cache = new EmbeddingCache({ ttl: 10 }); // 10 seconds
      const key = cache.generateKey('test query', 'test-model');
      const embedding = [0.1, 0.2, 0.3];
      
      cache.set(key, embedding);
      
      vi.useFakeTimers();
      vi.advanceTimersByTime(5000); // 5 seconds
      
      // Should still be available
      expect(cache.get(key)).toEqual(embedding);
      
      vi.useRealTimers();
    });

    it('should use default TTL of 3600 seconds', () => {
      const cache = new EmbeddingCache();
      const key = cache.generateKey('test query', 'test-model');
      const embedding = [0.1, 0.2, 0.3];
      
      cache.set(key, embedding);
      
      vi.useFakeTimers();
      vi.advanceTimersByTime(3599 * 1000); // Just under 1 hour
      
      // Should still be available
      expect(cache.get(key)).toEqual(embedding);
      
      vi.advanceTimersByTime(2000); // Push over 1 hour
      
      // Should be expired
      expect(cache.get(key)).toBeUndefined();
      
      vi.useRealTimers();
    });
  });

  describe('Max Size and LRU Eviction', () => {
    it('should respect max size limit', () => {
      const smallCache = new EmbeddingCache({ maxSize: 3 });
      
      for (let i = 0; i < 5; i++) {
        const key = smallCache.generateKey(`query ${i}`, 'test-model');
        smallCache.set(key, [i]);
      }
      
      expect(smallCache.size).toBe(3);
    });

    it('should evict least recently used entry when at max size', () => {
      const smallCache = new EmbeddingCache({ maxSize: 3 });
      
      const key1 = smallCache.generateKey('query 1', 'test-model');
      const key2 = smallCache.generateKey('query 2', 'test-model');
      const key3 = smallCache.generateKey('query 3', 'test-model');
      const key4 = smallCache.generateKey('query 4', 'test-model');
      
      smallCache.set(key1, [1]);
      smallCache.set(key2, [2]);
      smallCache.set(key3, [3]);
      
      // Access key2 and key3 to make key1 the LRU
      smallCache.get(key2);
      smallCache.get(key3);
      
      // Add key4, should evict key1
      smallCache.set(key4, [4]);
      
      expect(smallCache.get(key1)).toBeUndefined();
      expect(smallCache.get(key2)).toEqual([2]);
      expect(smallCache.get(key3)).toEqual([3]);
      expect(smallCache.get(key4)).toEqual([4]);
    });

    it('should update access time on get', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });
      
      const key1 = smallCache.generateKey('query 1', 'test-model');
      const key2 = smallCache.generateKey('query 2', 'test-model');
      const key3 = smallCache.generateKey('query 3', 'test-model');
      
      vi.useFakeTimers();
      
      smallCache.set(key1, [1]);
      vi.advanceTimersByTime(100);
      
      smallCache.set(key2, [2]);
      vi.advanceTimersByTime(100);
      
      // Access key1 to make it more recently used than key2
      smallCache.get(key1);
      vi.advanceTimersByTime(100);
      
      // Add key3, should evict key2 (LRU)
      smallCache.set(key3, [3]);
      
      expect(smallCache.get(key1)).toEqual([1]);
      expect(smallCache.get(key2)).toBeUndefined();
      expect(smallCache.get(key3)).toEqual([3]);
      
      vi.useRealTimers();
    });

    it('should use default max size of 1000', () => {
      const cache = new EmbeddingCache();
      
      for (let i = 0; i < 1000; i++) {
        const key = cache.generateKey(`query ${i}`, 'test-model');
        cache.set(key, [i]);
      }
      
      expect(cache.size).toBe(1000);
      
      // Adding one more should trigger eviction
      const extraKey = cache.generateKey('extra query', 'test-model');
      cache.set(extraKey, [9999]);
      
      expect(cache.size).toBe(1000);
    });

    it('should not evict when updating existing key', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });
      
      const key1 = smallCache.generateKey('query 1', 'test-model');
      const key2 = smallCache.generateKey('query 2', 'test-model');
      
      smallCache.set(key1, [1]);
      smallCache.set(key2, [2]);
      
      // Update key1 with new embedding
      smallCache.set(key1, [1.5]);
      
      expect(smallCache.size).toBe(2);
      expect(smallCache.get(key1)).toEqual([1.5]);
      expect(smallCache.get(key2)).toEqual([2]);
    });
  });

  describe('Clear', () => {
    it('should clear all entries', () => {
      const key1 = cache.generateKey('query 1', 'test-model');
      const key2 = cache.generateKey('query 2', 'test-model');
      
      cache.set(key1, [1]);
      cache.set(key2, [2]);
      
      expect(cache.size).toBe(2);
      
      cache.clear();
      
      expect(cache.size).toBe(0);
      expect(cache.get(key1)).toBeUndefined();
      expect(cache.get(key2)).toBeUndefined();
    });

    it('should allow adding entries after clear', () => {
      const key = cache.generateKey('test query', 'test-model');
      
      cache.set(key, [1]);
      cache.clear();
      cache.set(key, [2]);
      
      expect(cache.get(key)).toEqual([2]);
    });
  });

  describe('Size Property', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('should return correct size after additions', () => {
      cache.set(cache.generateKey('query 1', 'model'), [1]);
      expect(cache.size).toBe(1);
      
      cache.set(cache.generateKey('query 2', 'model'), [2]);
      expect(cache.size).toBe(2);
    });

    it('should return correct size after deletions', () => {
      const key = cache.generateKey('query', 'model');
      cache.set(key, [1]);
      
      expect(cache.size).toBe(1);
      
      // Trigger expiration
      const shortCache = new EmbeddingCache({ ttl: 1 });
      const shortKey = shortCache.generateKey('query', 'model');
      shortCache.set(shortKey, [1]);
      
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      
      shortCache.get(shortKey); // Trigger expiration check
      expect(shortCache.size).toBe(0);
      
      vi.useRealTimers();
    });
  });
});
