/**
 * Type definitions for Context Engine
 */

import type { Memory, Relationship, MemoryType } from '@memorylayer/storage';

/**
 * Search result with similarity score and optional relationships
 */
export interface SearchResult {
  memory: Memory;
  score: number;
  rank?: number;
  relationships?: RelatedMemory[];
}

/**
 * Related memory with relationship information
 */
export interface RelatedMemory {
  memory: Memory;
  relationship: Relationship;
  depth: number;
}

/**
 * Context result with formatted context string
 */
export interface ContextResult {
  context: string;
  tokenCount: number;
  memories: SearchResult[];
  truncated: boolean;
  template: string;
}

/**
 * Context preview with additional diagnostic metadata
 */
export interface ContextPreview extends ContextResult {
  memoryIds: string[];
  rankingScores: Record<string, number>;
  budgetUsed: number;
}

/**
 * Search options for filtering and configuration
 */
export interface SearchOptions {
  limit?: number;
  memoryTypes?: MemoryType[];
  dateFrom?: Date;
  dateTo?: Date;
  minConfidence?: number;
  conversationId?: string;
  includeRelationships?: boolean;
  relationshipDepth?: number;
}

/**
 * Context options extending search options with formatting configuration
 */
export interface ContextOptions extends SearchOptions {
  template?: string;
  tokenBudget?: number;
  ranker?: string | RankingFunction;
  includeMetadata?: boolean;
}

/**
 * Ranking function type
 */
export type RankingFunction = (results: SearchResult[], options: RankingOptions) => SearchResult[];

/**
 * Ranking options for weighting different factors
 */
export interface RankingOptions {
  recencyWeight?: number;
  confidenceWeight?: number;
  similarityWeight?: number;
  decayWeight?: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxSize?: number;
  ttl?: number;
}

/**
 * Logger interface
 */
export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

/**
 * Storage client interface (from @memorylayer/storage)
 */
export interface StorageClient {
  searchMemories(
    workspaceId: string,
    query: { vector: number[]; limit?: number; types?: MemoryType[]; dateFrom?: Date; dateTo?: Date }
  ): Promise<{ ok: true; value: Array<{ memory: Memory; score: number }> } | { ok: false; error: any }>;
  getMemory(memoryId: string, workspaceId: string): Promise<{ ok: true; value: Memory | null } | { ok: false; error: any }>;
  getMemoryRelationships(memoryId: string, workspaceId: string): Promise<{ ok: true; value: Relationship[] } | { ok: false; error: any }>;
}

/**
 * Context engine configuration
 */
export interface ContextEngineConfig {
  storageClient: StorageClient;
  embeddingProvider: EmbeddingProvider;
  expectedEmbeddingDimensions?: number;
  defaultTemplate?: string;
  defaultTokenBudget?: number;
  cacheConfig?: CacheConfig;
  logger?: Logger;
}

/**
 * Context template for formatting memories
 */
export interface ContextTemplate {
  name: string;
  header?: string;
  memoryFormat: string;
  separator: string;
  footer?: string;
  includeMetadata: boolean;
}

/**
 * Tokenizer interface for token counting
 */
export interface Tokenizer {
  count(text: string): number;
  encode(text: string): number[];
  decode(tokens: number[]): string;
}
