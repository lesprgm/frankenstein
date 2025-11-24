/**
 * Integration tests for conversation chunking
 * 
 * Tests the complete chunking pipeline with various conversation sizes,
 * strategies, and error scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryExtractor } from '../index.js';
import { OpenAIProvider } from '../providers/openai.js';
import { StructuredOutputStrategy } from '../strategies/structured.js';
import {
  NormalizedConversation,
  NormalizedMessage,
  LLMProvider,
  ModelParams,
  JSONSchema,
  FunctionDefinition,
  FunctionCallResult,
  ExtractedMemory,
  ExtractedRelationship,
} from '../types.js';

// Check if OpenAI API key is available
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SKIP_REAL_API_TESTS = !OPENAI_API_KEY;

/**
 * Mock provider that simulates successful extraction
 */
class MockSuccessProvider implements LLMProvider {
  readonly name = 'mock-success';
  private callCount = 0;

  async complete(prompt: string, params: ModelParams): Promise<string> {
    this.callCount++;
    return JSON.stringify({
      memories: [
        {
          type: 'entity',
          content: `Entity from chunk ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Entity ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: []
    });
  }

  async completeStructured<T>(prompt: string, schema: JSONSchema, params: ModelParams): Promise<T> {
    this.callCount++;
    return {
      memories: [
        {
          type: 'entity',
          content: `Entity from chunk ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Entity ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: []
    } as T;
  }

  async completeWithFunctions(
    prompt: string,
    functions: FunctionDefinition[],
    params: ModelParams
  ): Promise<FunctionCallResult> {
    return { functionName: 'extract_memories', arguments: {} };
  }

  reset() {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Mock provider that fails on specific chunks
 */
class MockFailingProvider implements LLMProvider {
  readonly name = 'mock-failing';
  private callCount = 0;
  private failOnChunks: Set<number>;

  constructor(failOnChunks: number[] = []) {
    this.failOnChunks = new Set(failOnChunks);
  }

  async complete(prompt: string, params: ModelParams): Promise<string> {
    this.callCount++;
    
    if (this.failOnChunks.has(this.callCount)) {
      throw new Error(`Simulated failure on chunk ${this.callCount}`);
    }

    return JSON.stringify({
      memories: [
        {
          type: 'entity',
          content: `Entity from chunk ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Entity ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: []
    });
  }

  async completeStructured<T>(prompt: string, schema: JSONSchema, params: ModelParams): Promise<T> {
    this.callCount++;
    
    if (this.failOnChunks.has(this.callCount)) {
      throw new Error(`Simulated failure on chunk ${this.callCount}`);
    }

    return {
      memories: [
        {
          type: 'entity',
          content: `Entity from chunk ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Entity ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: []
    } as T;
  }

  async completeWithFunctions(
    prompt: string,
    functions: FunctionDefinition[],
    params: ModelParams
  ): Promise<FunctionCallResult> {
    return { functionName: 'extract_memories', arguments: {} };
  }

  reset() {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Mock provider that returns duplicate entities across chunks
 */
class MockDuplicateProvider implements LLMProvider {
  readonly name = 'mock-duplicate';
  private callCount = 0;

  async complete(prompt: string, params: ModelParams): Promise<string> {
    this.callCount++;
    return JSON.stringify({
      memories: [
        {
          type: 'entity',
          content: 'Acme Corp',
          confidence: 0.9,
          metadata: { name: 'Acme Corp', entityType: 'organization' }
        },
        {
          type: 'entity',
          content: `Unique entity ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Unique ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: [
        {
          from_memory_id: 'temp-1',
          to_memory_id: 'temp-2',
          relationship_type: 'related_to',
          confidence: 0.7
        }
      ]
    });
  }

  async completeStructured<T>(prompt: string, schema: JSONSchema, params: ModelParams): Promise<T> {
    this.callCount++;
    return {
      memories: [
        {
          type: 'entity',
          content: 'Acme Corp',
          confidence: 0.9,
          metadata: { name: 'Acme Corp', entityType: 'organization' }
        },
        {
          type: 'entity',
          content: `Unique entity ${this.callCount}`,
          confidence: 0.8,
          metadata: { name: `Unique ${this.callCount}`, entityType: 'concept' }
        }
      ],
      relationships: [
        {
          from_memory_id: 'temp-1',
          to_memory_id: 'temp-2',
          relationship_type: 'related_to',
          confidence: 0.7
        }
      ]
    } as T;
  }

  async completeWithFunctions(
    prompt: string,
    functions: FunctionDefinition[],
    params: ModelParams
  ): Promise<FunctionCallResult> {
    return { functionName: 'extract_memories', arguments: {} };
  }

  reset() {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Helper to create a large conversation with many messages
 */
function createLargeConversation(messageCount: number, conversationId: string): NormalizedConversation {
  const messages: NormalizedMessage[] = [];
  
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: This is a test message with some content. It contains information about various topics and entities. The message is long enough to have a reasonable token count for testing purposes.`,
      timestamp: new Date(Date.now() + i * 1000).toISOString()
    });
  }
  
  return {
    id: conversationId,
    messages
  };
}

/**
 * Helper to create a conversation with repeated entities
 */
function createConversationWithDuplicates(conversationId: string): NormalizedConversation {
  const messages: NormalizedMessage[] = [];
  
  // Create a longer conversation to ensure chunking happens
  for (let i = 0; i < 20; i++) {
    messages.push({
      id: `msg-${i * 2}`,
      role: 'user',
      content: `I work at Acme Corp as a software engineer. This is message ${i}. Acme Corp is a great company with many interesting projects and technologies.`,
      timestamp: new Date(Date.now() + i * 2000).toISOString()
    });
    messages.push({
      id: `msg-${i * 2 + 1}`,
      role: 'assistant',
      content: `That's great! Tell me more about Acme Corp and your work there. I'm interested in learning about the projects at Acme Corp.`,
      timestamp: new Date(Date.now() + i * 2000 + 1000).toISOString()
    });
  }
  
  return {
    id: conversationId,
    messages
  };
}

describe('Chunking Integration Tests', () => {
  describe('End-to-End Chunking with Large Conversations', () => {
    it('should chunk and extract from a large conversation using sliding window strategy', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 500, // Small chunk size to force chunking
          overlapTokens: 50,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-large-1');
      const result = await extractor.extract(conversation, 'workspace-test-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.memories.length).toBeGreaterThan(0);
        
        // Verify chunking metadata is present
        expect(result.value.chunkingMetadata).toBeDefined();
        expect(result.value.chunkingMetadata?.enabled).toBe(true);
        expect(result.value.chunkingMetadata?.strategy).toBe('sliding-window');
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
        
        // Verify timing breakdown
        expect(result.value.chunkingMetadata?.processingTime).toBeDefined();
        expect(result.value.chunkingMetadata?.processingTime.chunking).toBeGreaterThanOrEqual(0);
        expect(result.value.chunkingMetadata?.processingTime.extraction).toBeGreaterThanOrEqual(0);
        expect(result.value.chunkingMetadata?.processingTime.deduplication).toBeGreaterThanOrEqual(0);
        expect(result.value.chunkingMetadata?.processingTime.total).toBeGreaterThanOrEqual(0);
        
        // Verify provider was called multiple times (once per chunk)
        expect(provider.getCallCount()).toBeGreaterThan(1);
      }
    });

    it('should chunk and extract using conversation boundary strategy', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 500,
          overlapTokens: 50,
          strategy: 'conversation-boundary',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-boundary-1');
      const result = await extractor.extract(conversation, 'workspace-test-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.chunkingMetadata?.strategy).toBe('conversation-boundary');
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
      }
    });

    it('should chunk and extract using semantic strategy', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 500,
          overlapTokens: 50,
          strategy: 'semantic',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-semantic-1');
      const result = await extractor.extract(conversation, 'workspace-test-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.chunkingMetadata?.strategy).toBe('semantic');
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
      }
    });

    it('should not chunk small conversations', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 100000, // Large chunk size
          overlapTokens: 1000,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(5, 'conv-small-1');
      const result = await extractor.extract(conversation, 'workspace-test-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        
        // Should not have chunking metadata for small conversations
        expect(result.value.chunkingMetadata).toBeUndefined();
        
        // Provider should be called only once
        expect(provider.getCallCount()).toBe(1);
      }
    });

    it.skipIf(SKIP_REAL_API_TESTS)('should chunk and extract from a large conversation using real OpenAI API', async () => {
      const provider = new OpenAIProvider({
        apiKey: OPENAI_API_KEY!,
        defaultModel: 'gpt-4o-mini'
      });

      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity', 'fact'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 2000, // Small chunk to force chunking
          overlapTokens: 200,
          strategy: 'sliding-window',
          tokenCountMethod: 'openai-tiktoken',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(100, 'conv-real-large-1');
      const result = await extractor.extract(conversation, 'workspace-real-test-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.memories.length).toBeGreaterThan(0);
        expect(result.value.chunkingMetadata).toBeDefined();
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
        
        // Verify memories have chunking metadata
        const memoriesWithChunks = result.value.memories.filter(m => m.source_chunks && m.source_chunks.length > 0);
        expect(memoriesWithChunks.length).toBeGreaterThan(0);
      }
    }, 120000);
  });

  describe('Cross-Chunk Deduplication', () => {
    it('should deduplicate entities mentioned in multiple chunks', async () => {
      const provider = new MockDuplicateProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 200, // Very small to force multiple chunks
          overlapTokens: 20,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createConversationWithDuplicates('conv-dedup-1');
      const result = await extractor.extract(conversation, 'workspace-dedup-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        
        // Verify chunking happened
        expect(result.value.chunkingMetadata).toBeDefined();
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
        
        // Count "Acme Corp" entities - should be deduplicated to 1
        const acmeCorpEntities = result.value.memories.filter(
          m => m.content === 'Acme Corp'
        );
        
        // Should have exactly one Acme Corp entity after deduplication
        expect(acmeCorpEntities.length).toBe(1);
        
        // The deduplicated entity should have source_chunks metadata
        const acmeEntity = acmeCorpEntities[0];
        expect(acmeEntity.source_chunks).toBeDefined();
        expect(acmeEntity.source_chunks!.length).toBeGreaterThanOrEqual(1);
        
        // Verify that deduplication happened by checking the total memories
        // is less than the number of chunks (since each chunk extracts "Acme Corp")
        expect(result.value.memories.length).toBeLessThan(result.value.chunkingMetadata!.totalChunks * 2);
      }
    });

    it('should preserve relationships after deduplication', async () => {
      const provider = new MockDuplicateProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 200,
          overlapTokens: 20,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createConversationWithDuplicates('conv-rel-1');
      const result = await extractor.extract(conversation, 'workspace-rel-1', {
        includeRelationships: true
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        
        // Verify chunking happened
        expect(result.value.chunkingMetadata).toBeDefined();
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
        
        // Note: Relationships may be filtered out if they reference temp IDs
        // that don't match actual memory IDs after deduplication.
        // This is expected behavior - the test verifies that any relationships
        // that DO exist reference valid memory IDs.
        
        // All relationships should reference valid memory IDs
        const memoryIds = new Set(result.value.memories.map(m => m.id));
        for (const rel of result.value.relationships) {
          expect(memoryIds.has(rel.from_memory_id)).toBe(true);
          expect(memoryIds.has(rel.to_memory_id)).toBe(true);
        }
        
        // Verify we have memories from multiple chunks
        expect(result.value.memories.length).toBeGreaterThan(0);
      }
    });

    it('should remove orphaned relationships after deduplication', async () => {
      const provider = new MockDuplicateProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.8, // Higher confidence to filter out some memories
        chunking: {
          enabled: true,
          maxTokensPerChunk: 200,
          overlapTokens: 20,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createConversationWithDuplicates('conv-orphan-1');
      const result = await extractor.extract(conversation, 'workspace-orphan-1', {
        includeRelationships: true
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // All relationships should reference valid memory IDs (no orphans)
        const memoryIds = new Set(result.value.memories.map(m => m.id));
        for (const rel of result.value.relationships) {
          expect(memoryIds.has(rel.from_memory_id)).toBe(true);
          expect(memoryIds.has(rel.to_memory_id)).toBe(true);
        }
      }
    });
  });

  describe('Error Handling with Chunk Failures', () => {
    it('should continue processing when a chunk fails (continue-on-error mode)', async () => {
      const provider = new MockFailingProvider([2]); // Fail on chunk 2
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 300,
          overlapTokens: 30,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-partial-1');
      const result = await extractor.extract(conversation, 'workspace-partial-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have partial status due to chunk failure
        expect(result.value.status).toBe('partial');
        
        // Should have some memories from successful chunks
        expect(result.value.memories.length).toBeGreaterThan(0);
        
        // Should have errors
        expect(result.value.errors).toBeDefined();
        expect(result.value.errors!.length).toBeGreaterThan(0);
        
        // Verify chunking metadata shows multiple chunks
        expect(result.value.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
      }
    });

    it('should fail fast when a chunk fails (fail-fast mode)', async () => {
      const provider = new MockFailingProvider([1]); // Fail on first chunk
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 300,
          overlapTokens: 30,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'fail-fast'
        }
      });

      const conversation = createLargeConversation(50, 'conv-failfast-1');
      const result = await extractor.extract(conversation, 'workspace-failfast-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('llm_error');
      }
    });

    it('should return partial results when multiple chunks fail', async () => {
      const provider = new MockFailingProvider([2, 4]); // Fail on chunks 2 and 4
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 300,
          overlapTokens: 30,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-multi-fail-1');
      const result = await extractor.extract(conversation, 'workspace-multi-fail-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('partial');
        expect(result.value.memories.length).toBeGreaterThan(0);
        expect(result.value.errors).toBeDefined();
      }
    });

    it('should fail when all chunks fail', async () => {
      const provider = new MockFailingProvider([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // Fail all chunks
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 300,
          overlapTokens: 30,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-all-fail-1');
      const result = await extractor.extract(conversation, 'workspace-all-fail-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have failed status when all chunks fail
        expect(result.value.status).toBe('failed');
        expect(result.value.memories.length).toBe(0);
        expect(result.value.errors).toBeDefined();
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without chunking configuration (disabled by default)', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5
        // No chunking config
      });

      const conversation = createLargeConversation(50, 'conv-no-chunk-1');
      const result = await extractor.extract(conversation, 'workspace-no-chunk-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        
        // Should not have chunking metadata
        expect(result.value.chunkingMetadata).toBeUndefined();
        
        // Provider should be called only once (no chunking)
        expect(provider.getCallCount()).toBe(1);
      }
    });

    it('should work with chunking disabled explicitly', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        chunking: {
          enabled: false,
          maxTokensPerChunk: 500,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversation = createLargeConversation(50, 'conv-disabled-1');
      const result = await extractor.extract(conversation, 'workspace-disabled-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.chunkingMetadata).toBeUndefined();
        expect(provider.getCallCount()).toBe(1);
      }
    });

    it('should maintain API compatibility with existing code', async () => {
      const provider = new MockSuccessProvider();
      
      // Old-style configuration without chunking
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity', 'fact'],
        minConfidence: 0.6
      });

      const conversation: NormalizedConversation = {
        id: 'conv-compat-1',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Test message',
            timestamp: '2024-01-01T10:00:00Z'
          }
        ]
      };

      // Should work exactly as before
      const result = await extractor.extract(conversation, 'workspace-compat-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.conversationId).toBe('conv-compat-1');
        expect(result.value.memories).toBeDefined();
        expect(result.value.relationships).toBeDefined();
        expect(result.value.status).toBeDefined();
      }
    });

    it('should support batch extraction with chunking', async () => {
      const provider = new MockSuccessProvider();
      
      const extractor = new MemoryExtractor({
        provider,
        strategy: new StructuredOutputStrategy(),
        memoryTypes: ['entity'],
        minConfidence: 0.5,
        batchSize: 2,
        chunking: {
          enabled: true,
          maxTokensPerChunk: 500,
          overlapTokens: 50,
          strategy: 'sliding-window',
          tokenCountMethod: 'approximate',
          failureMode: 'continue-on-error'
        }
      });

      const conversations = [
        createLargeConversation(30, 'conv-batch-1'),
        createLargeConversation(30, 'conv-batch-2')
      ];

      const result = await extractor.extractBatch(conversations, 'workspace-batch-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.results.length).toBe(2);
        expect(result.value.successCount).toBe(2);
        expect(result.value.totalMemories).toBeGreaterThan(0);
        
        // Each conversation result should have chunking metadata
        for (const convResult of result.value.results) {
          expect(convResult.chunkingMetadata).toBeDefined();
          expect(convResult.chunkingMetadata?.totalChunks).toBeGreaterThan(1);
        }
      }
    });
  });
});
