/**
 * Core types for memory extraction
 */

import { ExtractionError, ValidationError } from './errors.js';

/**
 * Extracted memory object - maps 1:1 to Storage Layer's memories table
 */
export interface ExtractedMemory {
  id: string;                      // Deterministic ID (hash-based)
  type: string;                    // 'entity', 'fact', 'decision', or custom
  content: string;
  confidence: number;              // 0-1
  workspace_id: string;
  conversation_id: string;
  source_message_ids: string[];
  metadata: Record<string, any>;   // Type-specific attributes
  created_at: string;              // ISO 8601
  
  // Chunking-related fields
  source_chunks?: string[];        // IDs of chunks this memory came from
  chunk_confidence?: number[];     // Confidence from each chunk
  merged_from?: string[];          // IDs of memories this was merged from
}

/**
 * Extracted relationship between memories - maps 1:1 to Storage Layer's relationships table
 */
export interface ExtractedRelationship {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relationship_type: string;
  confidence: number;
  created_at: string;
}

/**
 * Result of extracting memories from a single conversation
 */
export interface ExtractionResult {
  memories: ExtractedMemory[];
  relationships: ExtractedRelationship[];
  conversationId: string;
  status: 'success' | 'partial' | 'failed';
  errors?: ExtractionError[];
  chunkingMetadata?: ChunkingMetadata;
}

/**
 * Metadata about chunking for extraction results
 */
export interface ChunkingMetadata {
  enabled: boolean;
  strategy: string;
  totalChunks: number;
  totalTokens: number;
  averageTokensPerChunk: number;
  overlapTokens: number;
  processingTime: {
    chunking: number;
    extraction: number;
    deduplication: number;
    total: number;
  };
  chunkSizes: {
    min: number;
    max: number;
    avg: number;
  };
  extractionRate: {
    memoriesPerChunk: number;
    relationshipsPerChunk: number;
  };
}

/**
 * Result of batch extraction from multiple conversations
 */
export interface BatchExtractionResult {
  results: ExtractionResult[];
  totalMemories: number;
  totalRelationships: number;
  successCount: number;
  failureCount: number;
}

/**
 * Configuration for the MemoryExtractor
 */
export interface MemoryExtractorConfig {
  provider: LLMProvider;
  strategy: ExtractionStrategy;
  memoryTypes?: string[];          // Default: ['entity', 'fact', 'decision']
  minConfidence?: number;          // Default: 0.5
  batchSize?: number;              // Default: 10
  retryConfig?: RetryConfig;
  logger?: Logger;
  chunking?: ChunkingConfiguration; // Optional chunking configuration
}

/**
 * Configuration for conversation chunking
 */
export interface ChunkingConfiguration {
  enabled: boolean;                // Enable/disable chunking
  maxTokensPerChunk?: number;      // Default: 100000 (100k tokens)
  overlapTokens?: number;          // Fixed overlap in tokens
  overlapPercentage?: number;      // Overlap as percentage (e.g., 0.1 for 10%)
  strategy?: 'sliding-window' | 'conversation-boundary' | 'semantic' | 'custom';  // Default: 'sliding-window'
  tokenCountMethod?: 'openai-tiktoken' | 'anthropic-estimate' | 'gemini-estimate' | 'approximate';  // Default: 'approximate'
  failureMode?: 'fail-fast' | 'continue-on-error';  // Default: 'continue-on-error'
  parallelChunks?: number;         // Max parallel chunk processing (not implemented yet)
  customStrategyName?: string;     // Name of custom strategy when strategy is 'custom'
}

/**
 * Options for extraction operations
 */
export interface ExtractionOptions {
  profile?: string;                // Use named profile
  memoryTypes?: string[];          // Override config
  minConfidence?: number;          // Override config
  includeRelationships?: boolean;  // Default: true
}

/**
 * Retry configuration for LLM calls
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  complete(prompt: string, params: ModelParams): Promise<string>;
  completeStructured<T>(prompt: string, schema: JSONSchema, params: ModelParams): Promise<T>;
  completeWithFunctions(
    prompt: string,
    functions: FunctionDefinition[],
    params: ModelParams
  ): Promise<FunctionCallResult>;
  readonly name: string;
}

/**
 * Model parameters for LLM calls
 */
export interface ModelParams {
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * JSON Schema definition
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  items?: any;
  [key: string]: any;
}

/**
 * Function definition for function calling
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Result of function calling
 */
export interface FunctionCallResult {
  functionName: string;
  arguments: Record<string, any>;
}

/**
 * Extraction Strategy interface
 */
export interface ExtractionStrategy {
  extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult>;
  
  extractIncremental(
    messages: NormalizedMessage[],
    context: IncrementalContext
  ): Promise<RawExtractionResult>;
  
  readonly name: string;
}

/**
 * Configuration for extraction strategy
 */
export interface StrategyConfig {
  memoryTypes: string[];
  memoryTypeConfigs?: Map<string, MemoryTypeConfig>;  // Custom memory type configurations
  provider: LLMProvider;
  modelParams: ModelParams;
}

/**
 * Raw extraction result before validation and deduplication
 */
export interface RawExtractionResult {
  memories: Partial<ExtractedMemory>[];
  relationships: Partial<ExtractedRelationship>[];
}

/**
 * Normalized conversation structure (from chat-capture module)
 */
export interface NormalizedConversation {
  id: string;
  messages: NormalizedMessage[];
  metadata?: Record<string, any>;
}

/**
 * Normalized message structure (from chat-capture module)
 */
export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Context for incremental extraction
 */
export interface IncrementalContext {
  conversationId: string;
  workspaceId: string;
  existingMemories: ExtractedMemory[];
  messageHistory: NormalizedMessage[];
}

/**
 * Result of incremental extraction
 */
export interface IncrementalResult {
  newMemories: ExtractedMemory[];
  updatedMemories: ExtractedMemory[];
  newRelationships: ExtractedRelationship[];
}

/**
 * State of incremental extraction
 */
export interface IncrementalState {
  conversationId: string;
  workspaceId: string;
  messageCount: number;
  memoryCount: number;
  isFinalized: boolean;
}

/**
 * Extraction profile configuration
 */
export interface ExtractionProfile {
  strategy: ExtractionStrategy;
  provider: LLMProvider;
  modelParams: ModelParams;
  memoryTypes: string[];
  minConfidence: number;
}

/**
 * Memory type configuration
 */
export interface MemoryTypeConfig {
  type: string;
  extractionPrompt: string;
  schema?: JSONSchema;
  validator?: (memory: ExtractedMemory) => boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Batch validation result
 */
export interface BatchValidationResult {
  validMemories: ExtractedMemory[];
  invalidMemories: ExtractedMemory[];
  errors: ValidationError[];
}


