/**
 * Integration tests for ContextEngine
 * 
 * These tests require:
 * - A test Supabase database with migrations applied
 * - A test Vectorize index
 * - OpenAI API key for embeddings
 * 
 * Set the following environment variables:
 * - TEST_SUPABASE_URL
 * - TEST_SUPABASE_API_KEY
 * - TEST_VECTORIZE_ACCOUNT_ID
 * - TEST_VECTORIZE_API_TOKEN
 * - TEST_VECTORIZE_INDEX_NAME
 * - TEST_OPENAI_API_KEY
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { ContextEngine } from '../index';
import { OpenAIEmbeddingProvider } from '../embeddings/openai';
import { StorageClient } from '@memorylayer/storage';
import type { User, Workspace, Memory } from '@memorylayer/storage';

// Skip tests if environment variables are not set
const shouldSkip = !process.env.TEST_SUPABASE_URL || 
                   !process.env.TEST_SUPABASE_API_KEY ||
                   !process.env.TEST_VECTORIZE_ACCOUNT_ID ||
                   !process.env.TEST_VECTORIZE_API_TOKEN ||
                   !process.env.TEST_VECTORIZE_INDEX_NAME ||
                   !process.env.TEST_OPENAI_API_KEY;

describe.skipIf(shouldSkip)('ContextEngine Integration Tests', () => {
  let contextEngine: ContextEngine;
  let storageClient: StorageClient;
  let embeddingProvider: OpenAIEmbeddingProvider;
  let testUser: User;
  let testWorkspace: Workspace;
  
  // Track created resources for cleanup
  const createdMemories: string[] = [];

  beforeAll(async () => {
    // Initialize Storage Client
    storageClient = new StorageClient({
      postgres: {
        url: process.env.TEST_SUPABASE_URL!,
        apiKey: process.env.TEST_SUPABASE_API_KEY!,
      },
      vectorize: {
        accountId: process.env.TEST_VECTORIZE_ACCOUNT_ID!,
        apiToken: process.env.TEST_VECTORIZE_API_TOKEN!,
        indexName: process.env.TEST_VECTORIZE_INDEX_NAME!,
      },
    });

    // Initialize Embedding Provider
    embeddingProvider = new OpenAIEmbeddingProvider({
      apiKey: process.env.TEST_OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    });

    // Initialize Context Engine
    contextEngine = new ContextEngine({
      storageClient,
      embeddingProvider,
      expectedEmbeddingDimensions: 1536,
      defaultTemplate: 'chat',
      defaultTokenBudget: 2000,
    });

    // Create test user and workspace
    const userResult = await storageClient.createUser({
      email: `test-context-${Date.now()}@example.com`,
      name: 'Context Test User',
    });
    
    expect(userResult.ok).toBe(true);
    if (userResult.ok) {
      testUser = userResult.value;
    }

    const workspaceResult = await storageClient.createWorkspace({
      name: 'Context Test Workspace',
      type: 'personal',
      owner_id: testUser.id,
    });
    
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      testWorkspace = workspaceResult.value;
    }
  });

  afterEach(async () => {
    // Clean up test memories
    for (const memoryId of createdMemories) {
      await storageClient.deleteMemory(memoryId, testWorkspace.id);
    }
    createdMemories.length = 0;
  });

  describe('End-to-end search with real Storage Layer and embeddings', () => {
    it('should search memories by text query with real embeddings', async () => {
      // Create memories with real embeddings
      const memory1Content = 'Machine learning is a subset of artificial intelligence';
      const embedding1 = await embeddingProvider.embed(memory1Content);
      
      const memory1Result = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: memory1Content,
        confidence: 0.95,
        embedding: embedding1,
      });

      expect(memory1Result.ok).toBe(true);
      if (memory1Result.ok) {
        createdMemories.push(memory1Result.value.id);
      }

      const memory2Content = 'Deep learning uses neural networks with multiple layers';
      const embedding2 = await embeddingProvider.embed(memory2Content);
      
      const memory2Result = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: memory2Content,
        confidence: 0.9,
        embedding: embedding2,
      });

      expect(memory2Result.ok).toBe(true);
      if (memory2Result.ok) {
        createdMemories.push(memory2Result.value.id);
      }

      // Search with a related query
      const searchResult = await contextEngine.search(
        'What is machine learning?',
        testWorkspace.id,
        { limit: 5 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.length).toBeGreaterThan(0);
      expect(searchResult.value[0].memory).toBeDefined();
      expect(searchResult.value[0].score).toBeGreaterThan(0);
      expect(searchResult.value[0].score).toBeLessThanOrEqual(1);
    });

    it('should search by pre-computed vector', async () => {
      // Create a memory
      const content = 'TypeScript is a typed superset of JavaScript';
      const embedding = await embeddingProvider.embed(content);
      
      const memoryResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content,
        confidence: 0.9,
        embedding,
      });

      expect(memoryResult.ok).toBe(true);
      if (memoryResult.ok) {
        createdMemories.push(memoryResult.value.id);
      }

      // Search using a pre-computed vector
      const queryVector = await embeddingProvider.embed('Tell me about TypeScript');
      const searchResult = await contextEngine.searchByVector(
        queryVector,
        testWorkspace.id,
        { limit: 5 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.length).toBeGreaterThan(0);
    });

    it('should filter search results by memory type', async () => {
      // Create entity memory
      const entityContent = 'John Doe is a software engineer';
      const entityEmbedding = await embeddingProvider.embed(entityContent);
      
      const entityResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: entityContent,
        confidence: 0.95,
        embedding: entityEmbedding,
      });

      if (entityResult.ok) {
        createdMemories.push(entityResult.value.id);
      }

      // Create fact memory
      const factContent = 'Software engineers write code';
      const factEmbedding = await embeddingProvider.embed(factContent);
      
      const factResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: factContent,
        confidence: 0.9,
        embedding: factEmbedding,
      });

      if (factResult.ok) {
        createdMemories.push(factResult.value.id);
      }

      // Search with type filter
      const searchResult = await contextEngine.search(
        'software engineer',
        testWorkspace.id,
        { memoryTypes: ['entity'], limit: 10 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.every(r => r.memory.type === 'entity')).toBe(true);
    });

    it('should filter by confidence threshold', async () => {
      // Create high confidence memory
      const highConfContent = 'The sky is blue';
      const highConfEmbedding = await embeddingProvider.embed(highConfContent);
      
      await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: highConfContent,
        confidence: 0.95,
        embedding: highConfEmbedding,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      // Create low confidence memory
      const lowConfContent = 'The grass might be green';
      const lowConfEmbedding = await embeddingProvider.embed(lowConfContent);
      
      await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: lowConfContent,
        confidence: 0.5,
        embedding: lowConfEmbedding,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      // Search with confidence filter
      const searchResult = await contextEngine.search(
        'colors in nature',
        testWorkspace.id,
        { minConfidence: 0.9, limit: 10 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.every(r => r.memory.confidence >= 0.9)).toBe(true);
    });
  });

  describe('buildContext with various options', () => {
    it('should build context with default template', async () => {
      // Create test memories
      const contents = [
        'React is a JavaScript library for building user interfaces',
        'Vue.js is a progressive framework for building UIs',
        'Angular is a platform for building web applications',
      ];

      for (const content of contents) {
        const embedding = await embeddingProvider.embed(content);
        const result = await storageClient.createMemory({
          workspace_id: testWorkspace.id,
          type: 'fact',
          content,
          confidence: 0.9,
          embedding,
        });
        
        if (result.ok) {
          createdMemories.push(result.value.id);
        }
      }

      // Build context
      const contextResult = await contextEngine.buildContext(
        'What are JavaScript frameworks?',
        testWorkspace.id,
        { limit: 3 }
      );

      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      const { context, tokenCount, memories, truncated, template } = contextResult.value;
      
      expect(context).toBeDefined();
      expect(context.length).toBeGreaterThan(0);
      expect(tokenCount).toBeGreaterThan(0);
      expect(memories.length).toBeGreaterThan(0);
      expect(template).toBe('chat');
      expect(typeof truncated).toBe('boolean');
    });

    it('should build context with custom template', async () => {
      // Register custom template
      contextEngine.registerTemplate('test-detailed', {
        name: 'test-detailed',
        header: '=== Context ===\n',
        memoryFormat: '[{{type}}] {{content}} (score: {{score}})',
        separator: '\n---\n',
        footer: '\n=== End ===',
        includeMetadata: true,
      });

      // Create a memory
      const content = 'Python is a high-level programming language';
      const embedding = await embeddingProvider.embed(content);
      
      const memoryResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content,
        confidence: 0.95,
        embedding,
      });

      if (memoryResult.ok) {
        createdMemories.push(memoryResult.value.id);
      }

      // Build context with custom template
      const contextResult = await contextEngine.buildContext(
        'programming languages',
        testWorkspace.id,
        { template: 'test-detailed', limit: 5 }
      );

      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      expect(contextResult.value.context).toContain('=== Context ===');
      expect(contextResult.value.context).toContain('[fact]');
      expect(contextResult.value.template).toBe('test-detailed');
    });

    it('should respect token budget and truncate', async () => {
      // Create multiple memories with substantial content
      const longContents = [
        'The first principle of software engineering is to write clean, maintainable code that follows best practices and design patterns',
        'The second principle is to test your code thoroughly with unit tests, integration tests, and end-to-end tests',
        'The third principle is to document your code properly so that other developers can understand and maintain it',
        'The fourth principle is to refactor regularly to improve code quality and reduce technical debt',
      ];

      for (const content of longContents) {
        const embedding = await embeddingProvider.embed(content);
        const result = await storageClient.createMemory({
          workspace_id: testWorkspace.id,
          type: 'fact',
          content,
          confidence: 0.9,
          embedding,
        });
        
        if (result.ok) {
          createdMemories.push(result.value.id);
        }
      }

      // Build context with small token budget
      const contextResult = await contextEngine.buildContext(
        'software engineering principles',
        testWorkspace.id,
        { tokenBudget: 50, limit: 10 }
      );

      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      expect(contextResult.value.tokenCount).toBeLessThanOrEqual(50);
      expect(contextResult.value.truncated).toBe(true);
      expect(contextResult.value.memories.length).toBeLessThan(longContents.length);
    });

    it('should build context with custom ranker', async () => {
      // Register custom ranker that prioritizes recency
      contextEngine.registerRanker('recency-first', (results) => {
        return results.sort((a, b) => {
          const dateA = new Date(a.memory.created_at).getTime();
          const dateB = new Date(b.memory.created_at).getTime();
          return dateB - dateA;
        });
      });

      // Create memories with delays to ensure different timestamps
      const content1 = 'First memory about databases';
      const embedding1 = await embeddingProvider.embed(content1);
      await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: content1,
        confidence: 0.8,
        embedding: embedding1,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));

      const content2 = 'Second memory about databases';
      const embedding2 = await embeddingProvider.embed(content2);
      await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: content2,
        confidence: 0.9,
        embedding: embedding2,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      // Build context with custom ranker
      const contextResult = await contextEngine.buildContext(
        'databases',
        testWorkspace.id,
        { ranker: 'recency-first', limit: 10 }
      );

      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      expect(contextResult.value.memories.length).toBeGreaterThan(0);
    });
  });

  describe('Relationship expansion with real relationships', () => {
    it('should include related memories when requested', async () => {
      // Create two related memories
      const person = 'Alice is a data scientist';
      const personEmbedding = await embeddingProvider.embed(person);
      
      const personResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: person,
        confidence: 0.95,
        embedding: personEmbedding,
      });

      expect(personResult.ok).toBe(true);
      if (!personResult.ok) return;
      
      const personMemory = personResult.value;
      createdMemories.push(personMemory.id);

      const company = 'DataCorp specializes in machine learning';
      const companyEmbedding = await embeddingProvider.embed(company);
      
      const companyResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: company,
        confidence: 0.9,
        embedding: companyEmbedding,
      });

      expect(companyResult.ok).toBe(true);
      if (!companyResult.ok) return;
      
      const companyMemory = companyResult.value;
      createdMemories.push(companyMemory.id);

      // Create relationship
      const relationshipResult = await storageClient.createRelationship({
        from_memory_id: personMemory.id,
        to_memory_id: companyMemory.id,
        relationship_type: 'works_at',
        confidence: 0.9,
      });

      expect(relationshipResult.ok).toBe(true);

      // Search with relationship expansion
      const searchResult = await contextEngine.search(
        'data scientist',
        testWorkspace.id,
        { includeRelationships: true, relationshipDepth: 1, limit: 5 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      // Find the person memory in results
      const personResult2 = searchResult.value.find(r => r.memory.id === personMemory.id);
      
      if (personResult2) {
        expect(personResult2.relationships).toBeDefined();
        expect(personResult2.relationships!.length).toBeGreaterThan(0);
        expect(personResult2.relationships![0].memory.id).toBe(companyMemory.id);
        expect(personResult2.relationships![0].depth).toBe(1);
      }
    });

    it('should follow relationships to specified depth', async () => {
      // Create a chain of related memories
      const memory1Content = 'Project Alpha is a new initiative';
      const embedding1 = await embeddingProvider.embed(memory1Content);
      
      const memory1Result = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: memory1Content,
        confidence: 0.9,
        embedding: embedding1,
      });

      if (!memory1Result.ok) return;
      const memory1 = memory1Result.value;
      createdMemories.push(memory1.id);

      const memory2Content = 'Team Beta is working on the project';
      const embedding2 = await embeddingProvider.embed(memory2Content);
      
      const memory2Result = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: memory2Content,
        confidence: 0.9,
        embedding: embedding2,
      });

      if (!memory2Result.ok) return;
      const memory2 = memory2Result.value;
      createdMemories.push(memory2.id);

      const memory3Content = 'Bob leads Team Beta';
      const embedding3 = await embeddingProvider.embed(memory3Content);
      
      const memory3Result = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: memory3Content,
        confidence: 0.9,
        embedding: embedding3,
      });

      if (!memory3Result.ok) return;
      const memory3 = memory3Result.value;
      createdMemories.push(memory3.id);

      // Create relationships: memory1 -> memory2 -> memory3
      await storageClient.createRelationship({
        from_memory_id: memory1.id,
        to_memory_id: memory2.id,
        relationship_type: 'involves',
        confidence: 0.9,
      });

      await storageClient.createRelationship({
        from_memory_id: memory2.id,
        to_memory_id: memory3.id,
        relationship_type: 'led_by',
        confidence: 0.9,
      });

      // Search with depth 2
      const searchResult = await contextEngine.search(
        'Project Alpha',
        testWorkspace.id,
        { includeRelationships: true, relationshipDepth: 2, limit: 5 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      // Should find memory1 and its relationships
      const result1 = searchResult.value.find(r => r.memory.id === memory1.id);
      
      if (result1 && result1.relationships) {
        // Should have relationships at depth 1 and 2
        const depths = result1.relationships.map(r => r.depth);
        expect(Math.max(...depths)).toBe(2);
      }
    });

    it('should deduplicate memories across relationships', async () => {
      // Create memories with circular relationships
      const memA = 'Memory A about testing';
      const embeddingA = await embeddingProvider.embed(memA);
      
      const memAResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: memA,
        confidence: 0.9,
        embedding: embeddingA,
      });

      if (!memAResult.ok) return;
      createdMemories.push(memAResult.value.id);

      const memB = 'Memory B about testing';
      const embeddingB = await embeddingProvider.embed(memB);
      
      const memBResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: memB,
        confidence: 0.9,
        embedding: embeddingB,
      });

      if (!memBResult.ok) return;
      createdMemories.push(memBResult.value.id);

      // Create bidirectional relationships
      await storageClient.createRelationship({
        from_memory_id: memAResult.value.id,
        to_memory_id: memBResult.value.id,
        relationship_type: 'related_to',
        confidence: 0.9,
      });

      await storageClient.createRelationship({
        from_memory_id: memBResult.value.id,
        to_memory_id: memAResult.value.id,
        relationship_type: 'related_to',
        confidence: 0.9,
      });

      // Search with relationships
      const searchResult = await contextEngine.search(
        'testing',
        testWorkspace.id,
        { includeRelationships: true, relationshipDepth: 2, limit: 5 }
      );

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      // Each memory should appear only once in the main results
      const memoryIds = searchResult.value.map(r => r.memory.id);
      const uniqueIds = new Set(memoryIds);
      expect(memoryIds.length).toBe(uniqueIds.size);
    });
  });

  describe('Preview matches final output', () => {
    it('should generate preview with same content as buildContext', async () => {
      // Create test memory
      const content = 'Kubernetes is a container orchestration platform';
      const embedding = await embeddingProvider.embed(content);
      
      const memoryResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content,
        confidence: 0.95,
        embedding,
      });

      if (memoryResult.ok) {
        createdMemories.push(memoryResult.value.id);
      }

      const query = 'container orchestration';
      const options = { limit: 5, template: 'chat', tokenBudget: 1000 };

      // Get preview
      const previewResult = await contextEngine.previewContext(
        query,
        testWorkspace.id,
        options
      );

      expect(previewResult.ok).toBe(true);
      if (!previewResult.ok) return;

      // Get actual context
      const contextResult = await contextEngine.buildContext(
        query,
        testWorkspace.id,
        options
      );

      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      // Compare results
      expect(previewResult.value.context).toBe(contextResult.value.context);
      expect(previewResult.value.tokenCount).toBe(contextResult.value.tokenCount);
      expect(previewResult.value.truncated).toBe(contextResult.value.truncated);
      expect(previewResult.value.memories.length).toBe(contextResult.value.memories.length);
    });

    it('should include diagnostic metadata in preview', async () => {
      // Create test memory
      const content = 'GraphQL is a query language for APIs';
      const embedding = await embeddingProvider.embed(content);
      
      const memoryResult = await storageClient.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content,
        confidence: 0.9,
        embedding,
      });

      if (memoryResult.ok) {
        createdMemories.push(memoryResult.value.id);
      }

      // Get preview
      const previewResult = await contextEngine.previewContext(
        'API query language',
        testWorkspace.id,
        { limit: 5, tokenBudget: 500 }
      );

      expect(previewResult.ok).toBe(true);
      if (!previewResult.ok) return;

      const preview = previewResult.value;

      // Check diagnostic metadata
      expect(preview.memoryIds).toBeDefined();
      expect(Array.isArray(preview.memoryIds)).toBe(true);
      expect(preview.rankingScores).toBeDefined();
      expect(typeof preview.rankingScores).toBe('object');
      expect(preview.budgetUsed).toBeDefined();
      expect(typeof preview.budgetUsed).toBe('number');
      expect(preview.budgetUsed).toBeGreaterThanOrEqual(0);
      expect(preview.budgetUsed).toBeLessThanOrEqual(100);
    });
  });

  describe('Error handling with API failures', () => {
    it('should handle embedding generation failures gracefully', async () => {
      // Create a context engine with invalid API key
      const invalidProvider = new OpenAIEmbeddingProvider({
        apiKey: 'invalid-key',
        model: 'text-embedding-3-small',
      });

      const invalidEngine = new ContextEngine({
        storageClient,
        embeddingProvider: invalidProvider,
      });

      // Attempt search
      const searchResult = await invalidEngine.search(
        'test query',
        testWorkspace.id
      );

      expect(searchResult.ok).toBe(false);
      if (!searchResult.ok) {
        expect(searchResult.error.type).toBe('embedding_error');
      }
    });

    it('should handle storage failures gracefully', async () => {
      // Search with invalid workspace ID
      const searchResult = await contextEngine.search(
        'test query',
        '00000000-0000-0000-0000-000000000000',
        { limit: 5 }
      );

      // Should succeed but return empty results
      expect(searchResult.ok).toBe(true);
      if (searchResult.ok) {
        expect(searchResult.value.length).toBe(0);
      }
    });
  });

  describe('Graceful degradation on search failures', () => {
    it('should return empty context on search failure', async () => {
      // Build context with invalid workspace
      const contextResult = await contextEngine.buildContext(
        'test query',
        '00000000-0000-0000-0000-000000000000',
        { limit: 5 }
      );

      // Should succeed with empty context
      expect(contextResult.ok).toBe(true);
      if (contextResult.ok) {
        expect(contextResult.value.memories.length).toBe(0);
        expect(contextResult.value.context.length).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
