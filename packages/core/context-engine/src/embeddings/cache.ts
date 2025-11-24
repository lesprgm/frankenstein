/**
 * Embedding cache with TTL and LRU eviction
 */

import { createHash } from 'crypto';
import type { CacheConfig } from '../types';

interface CacheEntry {
  embedding: number[];
  timestamp: number;
  lastAccessed: number;
}

/**
 * In-memory cache for embeddings with TTL and LRU eviction
 */
export class EmbeddingCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttl: number; // in milliseconds

  constructor(config: CacheConfig = {}) {
    this.cache = new Map();
    this.maxSize = config.maxSize ?? 1000;
    this.ttl = (config.ttl ?? 3600) * 1000; // Convert seconds to milliseconds
  }

  /**
   * Get cached embedding if it exists and hasn't expired
   */
  get(key: string): number[] | undefined {
    if (!key) {
      return undefined;
    }
    
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return undefined;
      }

      // Check if entry has expired
      const now = Date.now();
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        return undefined;
      }

      // Update last accessed time for LRU
      entry.lastAccessed = now;
      
      return entry.embedding;
    } catch (error) {
      // If cache retrieval fails, return undefined
      return undefined;
    }
  }

  /**
   * Set cached embedding with current timestamp
   */
  set(key: string, embedding: number[]): void {
    if (!key || !embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return; // Silently ignore invalid inputs
    }
    
    try {
      const now = Date.now();
      
      // If cache is at max size and key doesn't exist, evict LRU entry
      if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
        this.evictLRU();
      }

      this.cache.set(key, {
        embedding,
        timestamp: now,
        lastAccessed: now,
      });
    } catch (error) {
      // If cache set fails, silently ignore (cache is optional)
    }
  }

  /**
   * Generate cache key from query text and model
   */
  generateKey(text: string, model: string): string {
    if (!text || !model) {
      throw new Error('Text and model are required for cache key generation');
    }
    
    try {
      const hash = createHash('sha256').update(text).digest('hex');
      return `${model}:${hash}`;
    } catch (error) {
      // Fallback to simple concatenation if hashing fails
      return `${model}:${text.substring(0, 50)}`;
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    try {
      this.cache.clear();
    } catch (error) {
      // Silently ignore clear failures
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    try {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry && entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    } catch (error) {
      // If eviction fails, try to clear the entire cache as fallback
      try {
        this.cache.clear();
      } catch (clearError) {
        // Silently ignore if even clearing fails
      }
    }
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
