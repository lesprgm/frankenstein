/**
 * Integration tests for StorageClient
 * 
 * These tests require:
 * - A test Supabase database with migrations applied
 * - A test Vectorize index
 * 
 * Set the following environment variables:
 * - TEST_SUPABASE_URL
 * - TEST_SUPABASE_API_KEY
 * - TEST_VECTORIZE_ACCOUNT_ID
 * - TEST_VECTORIZE_API_TOKEN
 * - TEST_VECTORIZE_INDEX_NAME
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { StorageClient } from '../client';
import type { User, Workspace, Conversation, Memory, Relationship } from '../models';

// Skip tests if environment variables are not set
const shouldSkip = !process.env.TEST_SUPABASE_URL || 
                   !process.env.TEST_SUPABASE_API_KEY ||
                   !process.env.TEST_VECTORIZE_ACCOUNT_ID ||
                   !process.env.TEST_VECTORIZE_API_TOKEN ||
                   !process.env.TEST_VECTORIZE_INDEX_NAME;

describe.skipIf(shouldSkip)('StorageClient Integration Tests', () => {
  let client: StorageClient;
  let testUser: User;
  let testWorkspace: Workspace;
  
  // Track created resources for cleanup
  const createdUsers: string[] = [];
  const createdWorkspaces: string[] = [];
  const createdConversations: string[] = [];
  const createdMemories: string[] = [];
  const createdRelationships: string[] = [];

  beforeAll(async () => {
    // Initialize StorageClient with test configuration
    client = new StorageClient({
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

    // Create a test user and workspace for use across tests
    const userResult = await client.createUser({
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
    });
    
    expect(userResult.ok).toBe(true);
    if (userResult.ok) {
      testUser = userResult.value;
      createdUsers.push(testUser.id);
    }

    const workspaceResult = await client.createWorkspace({
      name: 'Test Workspace',
      type: 'personal',
      owner_id: testUser.id,
    });
    
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      testWorkspace = workspaceResult.value;
      createdWorkspaces.push(testWorkspace.id);
    }
  });

  afterEach(async () => {
    // Clean up test data in reverse order of dependencies
    // Relationships are deleted automatically via CASCADE
    
    // Delete memories (also deletes from Vectorize)
    for (const memoryId of createdMemories) {
      await client.deleteMemory(memoryId, testWorkspace.id);
    }
    createdMemories.length = 0;

    // Conversations are deleted via CASCADE when workspace is deleted
    createdConversations.length = 0;
    createdRelationships.length = 0;
  });

  describe('User and Workspace Operations', () => {
    it('should create and retrieve a user', async () => {
      const email = `user-${Date.now()}@example.com`;
      const createResult = await client.createUser({
        email,
        name: 'John Doe',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const user = createResult.value;
      createdUsers.push(user.id);

      expect(user.email).toBe(email);
      expect(user.name).toBe('John Doe');
      expect(user.id).toBeDefined();
      expect(user.created_at).toBeInstanceOf(Date);

      // Retrieve the user
      const getResult = await client.getUser(user.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value).not.toBeNull();
      expect(getResult.value?.id).toBe(user.id);
      expect(getResult.value?.email).toBe(email);
    });

    it('should return null for non-existent user', async () => {
      const result = await client.getUser('00000000-0000-0000-0000-000000000000');
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should reject duplicate email', async () => {
      const email = `duplicate-${Date.now()}@example.com`;
      
      const first = await client.createUser({
        email,
        name: 'First User',
      });
      
      expect(first.ok).toBe(true);
      if (first.ok) {
        createdUsers.push(first.value.id);
      }

      const second = await client.createUser({
        email,
        name: 'Second User',
      });
      
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.type).toBe('conflict');
      }
    });

    it('should create and retrieve a workspace', async () => {
      const createResult = await client.createWorkspace({
        name: 'My Personal Workspace',
        type: 'personal',
        owner_id: testUser.id,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const workspace = createResult.value;
      createdWorkspaces.push(workspace.id);

      expect(workspace.name).toBe('My Personal Workspace');
      expect(workspace.type).toBe('personal');
      expect(workspace.owner_id).toBe(testUser.id);

      // Retrieve the workspace
      const getResult = await client.getWorkspace(workspace.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value).not.toBeNull();
      expect(getResult.value?.id).toBe(workspace.id);
    });

    it('should list user workspaces', async () => {
      // Create additional workspace
      const workspace2Result = await client.createWorkspace({
        name: 'Second Workspace',
        type: 'team',
        owner_id: testUser.id,
      });

      expect(workspace2Result.ok).toBe(true);
      if (workspace2Result.ok) {
        createdWorkspaces.push(workspace2Result.value.id);
      }

      const listResult = await client.listUserWorkspaces(testUser.id);
      
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      expect(listResult.value.length).toBeGreaterThanOrEqual(2);
      expect(listResult.value.every(w => w.owner_id === testUser.id)).toBe(true);
    });
  });

  describe('Conversation Operations with Workspace Scoping', () => {
    it('should create and retrieve a conversation', async () => {
      const createResult = await client.createConversation({
        workspace_id: testWorkspace.id,
        provider: 'slack',
        external_id: 'C12345',
        title: 'Test Conversation',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const conversation = createResult.value;
      createdConversations.push(conversation.id);

      expect(conversation.workspace_id).toBe(testWorkspace.id);
      expect(conversation.provider).toBe('slack');
      expect(conversation.external_id).toBe('C12345');
      expect(conversation.title).toBe('Test Conversation');

      // Retrieve with correct workspace
      const getResult = await client.getConversation(conversation.id, testWorkspace.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value).not.toBeNull();
      expect(getResult.value?.id).toBe(conversation.id);
    });

    it('should enforce workspace scoping on conversation retrieval', async () => {
      const createResult = await client.createConversation({
        workspace_id: testWorkspace.id,
        provider: 'slack',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const conversation = createResult.value;
      createdConversations.push(conversation.id);

      // Try to retrieve with wrong workspace ID
      const wrongWorkspaceId = '00000000-0000-0000-0000-000000000000';
      const getResult = await client.getConversation(conversation.id, wrongWorkspaceId);
      
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('should list conversations with pagination', async () => {
      // Create multiple conversations
      for (let i = 0; i < 3; i++) {
        const result = await client.createConversation({
          workspace_id: testWorkspace.id,
          provider: 'test',
          title: `Conversation ${i}`,
        });
        
        if (result.ok) {
          createdConversations.push(result.value.id);
        }
      }

      // List with limit
      const listResult = await client.listConversations(testWorkspace.id, {
        limit: 2,
        orderBy: 'created_at_desc',
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      expect(listResult.value.length).toBeLessThanOrEqual(2);
      expect(listResult.value.every(c => c.workspace_id === testWorkspace.id)).toBe(true);
    });
  });

  describe('Memory Operations with Embedding Lifecycle', () => {
    it('should create and retrieve a memory without embedding', async () => {
      const createResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'John works at Acme Corp',
        confidence: 0.95,
        metadata: { source: 'test' },
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const memory = createResult.value;
      createdMemories.push(memory.id);

      expect(memory.workspace_id).toBe(testWorkspace.id);
      expect(memory.type).toBe('entity');
      expect(memory.content).toBe('John works at Acme Corp');
      expect(memory.confidence).toBe(0.95);

      // Retrieve the memory
      const getResult = await client.getMemory(memory.id, testWorkspace.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value).not.toBeNull();
      expect(getResult.value?.id).toBe(memory.id);
    });

    it('should create a memory with embedding', async () => {
      // Generate a simple test embedding (384 dimensions)
      const embedding = Array.from({ length: 384 }, () => Math.random());

      const createResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: 'The meeting is scheduled for 3pm',
        confidence: 0.9,
        embedding,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const memory = createResult.value;
      createdMemories.push(memory.id);

      expect(memory.id).toBeDefined();
      expect(memory.type).toBe('fact');
    });

    it('should enforce workspace scoping on memory retrieval', async () => {
      const createResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'decision',
        content: 'We decided to use TypeScript',
        confidence: 1.0,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const memory = createResult.value;
      createdMemories.push(memory.id);

      // Try to retrieve with wrong workspace ID
      const wrongWorkspaceId = '00000000-0000-0000-0000-000000000000';
      const getResult = await client.getMemory(memory.id, wrongWorkspaceId);
      
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('should list memories with type filtering', async () => {
      // Create memories of different types
      await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'Alice',
        confidence: 0.9,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: 'Sky is blue',
        confidence: 0.95,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'Bob',
        confidence: 0.85,
      }).then(r => r.ok && createdMemories.push(r.value.id));

      // List only entities
      const listResult = await client.listMemories(testWorkspace.id, {
        types: ['entity'],
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      expect(listResult.value.every(m => m.type === 'entity')).toBe(true);
      expect(listResult.value.length).toBeGreaterThanOrEqual(2);
    });

    it('should delete a memory from both Postgres and Vectorize', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      const createResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'Temporary memory',
        confidence: 0.8,
        embedding,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const memory = createResult.value;

      // Delete the memory
      const deleteResult = await client.deleteMemory(memory.id, testWorkspace.id);
      expect(deleteResult.ok).toBe(true);

      // Verify it's deleted from Postgres
      const getResult = await client.getMemory(memory.id, testWorkspace.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });
  });

  describe('Semantic Search with Actual Embeddings', () => {
    it('should search memories by vector similarity', async () => {
      // Create memories with similar embeddings
      const baseEmbedding = Array.from({ length: 384 }, () => Math.random());
      
      // Create first memory with base embedding
      const memory1Result = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: 'Machine learning is a subset of AI',
        confidence: 0.9,
        embedding: baseEmbedding,
      });

      expect(memory1Result.ok).toBe(true);
      if (memory1Result.ok) {
        createdMemories.push(memory1Result.value.id);
      }

      // Create second memory with slightly different embedding
      const similarEmbedding = baseEmbedding.map(v => v + (Math.random() - 0.5) * 0.1);
      const memory2Result = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: 'Deep learning uses neural networks',
        confidence: 0.85,
        embedding: similarEmbedding,
      });

      expect(memory2Result.ok).toBe(true);
      if (memory2Result.ok) {
        createdMemories.push(memory2Result.value.id);
      }

      // Search with query vector similar to base embedding
      const queryVector = baseEmbedding.map(v => v + (Math.random() - 0.5) * 0.05);
      const searchResult = await client.searchMemories(testWorkspace.id, {
        vector: queryVector,
        limit: 10,
      });

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.length).toBeGreaterThan(0);
      expect(searchResult.value[0].memory).toBeDefined();
      expect(searchResult.value[0].score).toBeGreaterThan(0);
      expect(searchResult.value[0].score).toBeLessThanOrEqual(1);
    });

    it('should filter search results by memory type', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      // Create entity memory
      const entityResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'Company XYZ',
        confidence: 0.9,
        embedding,
      });

      if (entityResult.ok) {
        createdMemories.push(entityResult.value.id);
      }

      // Create fact memory with similar embedding
      const factResult = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'fact',
        content: 'Company XYZ was founded in 2020',
        confidence: 0.85,
        embedding: embedding.map(v => v + (Math.random() - 0.5) * 0.1),
      });

      if (factResult.ok) {
        createdMemories.push(factResult.value.id);
      }

      // Search with type filter for entities only
      const searchResult = await client.searchMemories(testWorkspace.id, {
        vector: embedding,
        types: ['entity'],
        limit: 10,
      });

      expect(searchResult.ok).toBe(true);
      if (!searchResult.ok) return;

      expect(searchResult.value.every(r => r.memory.type === 'entity')).toBe(true);
    });
  });

  describe('Relationship Operations with Workspace Validation', () => {
    let memory1: Memory;
    let memory2: Memory;

    beforeAll(async () => {
      // Create two memories for relationship tests
      const m1Result = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'John Doe',
        confidence: 0.95,
      });

      if (m1Result.ok) {
        memory1 = m1Result.value;
        createdMemories.push(memory1.id);
      }

      const m2Result = await client.createMemory({
        workspace_id: testWorkspace.id,
        type: 'entity',
        content: 'Acme Corp',
        confidence: 0.9,
      });

      if (m2Result.ok) {
        memory2 = m2Result.value;
        createdMemories.push(memory2.id);
      }
    });

    it('should create a relationship between memories', async () => {
      const createResult = await client.createRelationship({
        from_memory_id: memory1.id,
        to_memory_id: memory2.id,
        relationship_type: 'works_at',
        confidence: 0.9,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const relationship = createResult.value;
      createdRelationships.push(relationship.id);

      expect(relationship.from_memory_id).toBe(memory1.id);
      expect(relationship.to_memory_id).toBe(memory2.id);
      expect(relationship.relationship_type).toBe('works_at');
      expect(relationship.confidence).toBe(0.9);
    });

    it('should retrieve relationships for a memory', async () => {
      // Create a relationship
      const createResult = await client.createRelationship({
        from_memory_id: memory1.id,
        to_memory_id: memory2.id,
        relationship_type: 'knows',
        confidence: 0.85,
      });

      if (createResult.ok) {
        createdRelationships.push(createResult.value.id);
      }

      // Get relationships for memory1
      const getResult = await client.getMemoryRelationships(memory1.id, testWorkspace.id);

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value.length).toBeGreaterThan(0);
      expect(getResult.value.some(r => 
        r.from_memory_id === memory1.id && r.to_memory_id === memory2.id
      )).toBe(true);
    });

    it('should prevent cross-workspace relationships', async () => {
      // Create a second workspace
      const workspace2Result = await client.createWorkspace({
        name: 'Second Workspace',
        type: 'personal',
        owner_id: testUser.id,
      });

      expect(workspace2Result.ok).toBe(true);
      if (!workspace2Result.ok) return;

      const workspace2 = workspace2Result.value;
      createdWorkspaces.push(workspace2.id);

      // Create a memory in the second workspace
      const memory3Result = await client.createMemory({
        workspace_id: workspace2.id,
        type: 'entity',
        content: 'Different workspace memory',
        confidence: 0.9,
      });

      expect(memory3Result.ok).toBe(true);
      if (!memory3Result.ok) return;

      const memory3 = memory3Result.value;

      // Try to create a relationship across workspaces
      const relationshipResult = await client.createRelationship({
        from_memory_id: memory1.id,
        to_memory_id: memory3.id,
        relationship_type: 'related_to',
        confidence: 0.8,
      });

      expect(relationshipResult.ok).toBe(false);
      if (!relationshipResult.ok) {
        expect(relationshipResult.error.type).toBe('validation');
        expect(relationshipResult.error.message).toContain('different workspaces');
      }

      // Clean up
      await client.deleteMemory(memory3.id, workspace2.id);
    });
  });

  describe('Transaction Rollback Scenarios', () => {
    it('should rollback transaction on error', async () => {
      const initialMemoriesResult = await client.listMemories(testWorkspace.id);
      expect(initialMemoriesResult.ok).toBe(true);
      if (!initialMemoriesResult.ok) return;

      const initialCount = initialMemoriesResult.value.length;

      // Attempt a transaction that will fail
      const txResult = await client.transaction(async (tx) => {
        // Create a memory
        const memory = await tx.insert<Memory>('memories', {
          workspace_id: testWorkspace.id,
          type: 'entity',
          content: 'Transaction test',
          confidence: 0.9,
          metadata: {},
        });

        // Intentionally cause an error
        throw new Error('Intentional error for rollback test');
      });

      expect(txResult.ok).toBe(false);

      // Verify no new memories were created
      const finalMemoriesResult = await client.listMemories(testWorkspace.id);
      expect(finalMemoriesResult.ok).toBe(true);
      if (!finalMemoriesResult.ok) return;

      expect(finalMemoriesResult.value.length).toBe(initialCount);
    });

    it('should commit transaction on success', async () => {
      const initialMemoriesResult = await client.listMemories(testWorkspace.id);
      expect(initialMemoriesResult.ok).toBe(true);
      if (!initialMemoriesResult.ok) return;

      const initialCount = initialMemoriesResult.value.length;

      // Execute a successful transaction
      const txResult = await client.transaction(async (tx) => {
        const memory = await tx.insert<Memory>('memories', {
          workspace_id: testWorkspace.id,
          type: 'entity',
          content: 'Transaction success test',
          confidence: 0.9,
          metadata: {},
        });

        return memory;
      });

      expect(txResult.ok).toBe(true);
      if (!txResult.ok) return;

      const createdMemory = txResult.value;
      createdMemories.push(createdMemory.id);

      // Verify the memory was created
      const finalMemoriesResult = await client.listMemories(testWorkspace.id);
      expect(finalMemoriesResult.ok).toBe(true);
      if (!finalMemoriesResult.ok) return;

      expect(finalMemoriesResult.value.length).toBe(initialCount + 1);
    });
  });
});
