/**
 * Enhanced embedding and result cache with LRU eviction
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import type { CacheConfig } from '../types';
import type { ContextResult, SearchResult } from '../types';

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/**
 * In-memory cache for embeddings using LRU eviction policy
 */
export class EmbeddingCache {
  private cache: LRUCache<string, number[]>;
  private stats: CacheStats;

  constructor(config: CacheConfig = {}) {
    this.cache = new LRUCache<string, number[]>({
      max: config.maxSize ?? 10000,        // Max 10K embeddings
      ttl: (config.ttl ?? 3600) * 1000,    // TTL in milliseconds
      updateAgeOnGet: true,                 // LRU behavior
      updateAgeOnHas: false,
    });

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Get cached embedding if it exists and hasn't expired
   */
  get(key: string): number[] | undefined {
    if (!key) {
      this.stats.misses++;
      return undefined;
    }

    const embedding = this.cache.get(key);

    if (embedding) {
      this.stats.hits++;
      return embedding;
    }

    this.stats.misses++;
    return undefined;
  }

  /**
   * Set cached embedding
   */
  set(key: string, embedding: number[]): void {
    if (!key || !embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return;
    }

    this.cache.set(key, embedding);
    this.stats.size = this.cache.size;
  }

  /**
   * Generate cache key from query text and model
   */
  generateKey(text: string, model: string): string {
    if (!text || !model) {
      throw new Error('Text and model are required for cache key generation');
    }

    const hash = createHash('sha256').update(text).digest('hex');
    return `${model}:${hash}`;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size,
    };
  }

  /**
   * Get cache hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Cache for search results with LRU eviction
 */
export class ResultCache {
  private cache: LRUCache<string, SearchResult[]>;
  private stats: CacheStats;

  constructor(config: CacheConfig = {}) {
    this.cache = new LRUCache<string, SearchResult[]>({
      max: config.maxSize ?? 1000,         // Max 1K result sets
      ttl: (config.ttl ?? 300) * 1000,     // 5 minute TTL (shorter than embeddings)
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Generate cache key from search parameters
   */
  generateKey(params: {
    query: string;
    workspaceId: string;
    limit?: number;
    types?: string[];
    minScore?: number;
  }): string {
    const normalized = {
      query: params.query,
      workspace: params.workspaceId,
      limit: params.limit ?? 10,
      types: params.types?.sort() ?? [],
      minScore: params.minScore ?? 0,
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');

    return `search:${hash}`;
  }

  /**
   * Get cached search results
   */
  get(key: string): SearchResult[] | undefined {
    const results = this.cache.get(key);

    if (results) {
      this.stats.hits++;
      return results;
    }

    this.stats.misses++;
    return undefined;
  }

  /**
   * Set cached search results
   */
  set(key: string, results: SearchResult[]): void {
    if (!key || !results) return;

    this.cache.set(key, results);
    this.stats.size = this.cache.size;
  }

  /**
   * Clear all cached results
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size,
    };
  }

  /**
   * Get cache hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Cache for formatted context results
 */
export class ContextCache {
  private cache: LRUCache<string, ContextResult>;
  private stats: CacheStats;

  constructor(config: CacheConfig = {}) {
    this.cache = new LRUCache<string, ContextResult>({
      max: config.maxSize ?? 500,          // Max 500 contexts
      ttl: (config.ttl ?? 180) * 1000,     // 3 minute TTL (shortest)
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Generate cache key from context build parameters
   */
  generateKey(params: {
    query: string;
    workspaceId: string;
    limit?: number;
    includeRelationships?: boolean;
    relationshipDepth?: number;
    tokenBudget?: number;
    template?: string;
  }): string {
    const normalized = {
      query: params.query,
      workspace: params.workspaceId,
      limit: params.limit ?? 10,
      relationships: params.includeRelationships ?? false,
      depth: params.relationshipDepth ?? 1,
      budget: params.tokenBudget ?? 1000,
      template: params.template ?? 'default',
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');

    return `context:${hash}`;
  }

  /**
   * Get cached context
   */
  get(key: string): ContextResult | undefined {
    const context = this.cache.get(key);

    if (context) {
      this.stats.hits++;
      return context;
    }

    this.stats.misses++;
    return undefined;
  }

  /**
   * Set cached context
   */
  set(key: string, context: ContextResult): void {
    if (!key || !context) return;

    this.cache.set(key, context);
    this.stats.size = this.cache.size;
  }

  /**
   * Clear all cached contexts
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size,
    };
  }

  /**
   * Get cache hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
