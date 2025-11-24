/**
 * Error handling tests for Context Engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextEngine } from '../index';
import type { EmbeddingProvider, StorageClient } from '../types';

// Mock embedding provider
class MockEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly dimensions: number = 1536,
    public readonly model: string = 'test-model',
    private shouldFail: boolean = false
  ) {}

  async embed(text: string): Promise<number[]> {
    if (this.shouldFail) {
      throw new Error('Embedding generation failed');
    }
    return new Array(this.dimensions).fill(0.1);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.shouldFail) {
      throw new Error('Batch embedding generation failed');
    }
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }
}

// Mock storage client
class MockStorageClient implements StorageClient {
  constructor(private shouldFail: boolean = false) {}

  async searchMemories(workspaceId: string, query: any) {
    if (this.shouldFail) {
      return { ok: false, error: new Error('Storage search failed') };
    }
    return { ok: true, value: [] };
  }

  async getMemory(memoryId: string, workspaceId: string) {
    if (this.shouldFail) {
      return { ok: false, error: new Error('Memory fetch failed') };
    }
    return { ok: true, value: null };
  }

  async getMemoryRelationships(memoryId: string, workspaceId: string) {
    if (this.shouldFail) {
      return { ok: false, error: new Error('Relationships fetch failed') };
    }
    return { ok: true, value: [] };
  }
}

describe('ContextEngine Error Handling', () => {
  let storageClient: MockStorageClient;
  let embeddingProvider: MockEmbeddingProvider;

  beforeEach(() => {
    storageClient = new MockStorageClient();
    embeddingProvider = new MockEmbeddingProvider();
  });

  describe('Constructor Validation', () => {
    it('should throw error if storageClient is missing', () => {
      expect(() => {
        new ContextEngine({
          storageClient: null as any,
          embeddingProvider,
        });
      }).toThrow('storageClient is required');
    });

    it('should throw error if embeddingProvider is missing', () => {
      expect(() => {
        new ContextEngine({
          storageClient,
          embeddingProvider: null as any,
        });
      }).toThrow('embeddingProvider is required');
    });

    it('should throw error if embedding dimensions mismatch', () => {
      expect(() => {
        new ContextEngine({
          storageClient,
          embeddingProvider,
          expectedEmbeddingDimensions: 999,
        });
      }).toThrow('do not match expected dimensions');
    });

    it('should throw error if embedding dimensions are invalid', () => {
      const invalidProvider = new MockEmbeddingProvider(0);
      expect(() => {
        new ContextEngine({
          storageClient,
          embeddingProvider: invalidProvider,
        });
      }).toThrow('Invalid embedding dimensions');
    });

    it('should throw error if default token budget is invalid', () => {
      expect(() => {
        new ContextEngine({
          storageClient,
          embeddingProvider,
          defaultTokenBudget: -100,
        });
      }).toThrow('Invalid default token budget');
    });

    it('should throw error if default template is invalid', () => {
      expect(() => {
        new ContextEngine({
          storageClient,
          embeddingProvider,
          defaultTemplate: 'nonexistent',
        });
      }).toThrow('Invalid default template');
    });
  });

  describe('Search Validation', () => {
    let engine: ContextEngine;

    beforeEach(() => {
      engine = new ContextEngine({
        storageClient,
        embeddingProvider,
      });
    });

    it('should return validation error for empty query', async () => {
      const result = await engine.search('', 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('Query text is required');
      }
    });

    it('should return validation error for empty workspace ID', async () => {
      const result = await engine.search('test query', '');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('Workspace ID is required');
      }
    });

    it('should return validation error for invalid vector dimensions', async () => {
      const result = await engine.searchByVector([0.1, 0.2], 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('do not match expected dimensions');
      }
    });

    it('should return validation error for empty vector', async () => {
      const result = await engine.searchByVector([], 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('Vector is required');
      }
    });

    it('should return validation error for vector with invalid values', async () => {
      const invalidVector = new Array(1536).fill(NaN);
      const result = await engine.searchByVector(invalidVector, 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('invalid values');
      }
    });
  });

  describe('Embedding Error Handling', () => {
    it('should return embedding error when provider fails', async () => {
      const failingProvider = new MockEmbeddingProvider(1536, 'test-model', true);
      const engine = new ContextEngine({
        storageClient,
        embeddingProvider: failingProvider,
      });

      const result = await engine.search('test query', 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('embedding_error');
        expect(result.error.message).toContain('Failed to generate embedding');
      }
    });
  });

  describe('Storage Error Handling', () => {
    it('should return storage error when storage client fails', async () => {
      const failingStorage = new MockStorageClient(true);
      const engine = new ContextEngine({
        storageClient: failingStorage,
        embeddingProvider,
      });

      const validVector = new Array(1536).fill(0.1);
      const result = await engine.searchByVector(validVector, 'workspace-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('storage_error');
        expect(result.error.message).toContain('Failed to search memories');
      }
    });
  });

  describe('Template Registration Validation', () => {
    let engine: ContextEngine;

    beforeEach(() => {
      engine = new ContextEngine({
        storageClient,
        embeddingProvider,
      });
    });

    it('should throw error for empty template name', () => {
      expect(() => {
        engine.registerTemplate('', {
          name: '',
          memoryFormat: '{{content}}',
          separator: '\n',
          includeMetadata: false,
        });
      }).toThrow('Template name cannot be empty');
    });

    it('should throw error for conflicting template name', () => {
      expect(() => {
        engine.registerTemplate('chat', {
          name: 'chat',
          memoryFormat: '{{content}}',
          separator: '\n',
          includeMetadata: false,
        });
      }).toThrow('conflicts with default template');
    });

    it('should throw error for empty memoryFormat', () => {
      expect(() => {
        engine.registerTemplate('custom', {
          name: 'custom',
          memoryFormat: '',
          separator: '\n',
          includeMetadata: false,
        });
      }).toThrow('memoryFormat cannot be empty');
    });
  });

  describe('Ranker Registration Validation', () => {
    let engine: ContextEngine;

    beforeEach(() => {
      engine = new ContextEngine({
        storageClient,
        embeddingProvider,
      });
    });

    it('should throw error for empty ranker name', () => {
      expect(() => {
        engine.registerRanker('', () => []);
      }).toThrow('Ranker name cannot be empty');
    });

    it('should throw error for conflicting ranker name', () => {
      expect(() => {
        engine.registerRanker('default', () => []);
      }).toThrow('conflicts with default ranker');
    });

    it('should throw error for non-function ranker', () => {
      expect(() => {
        engine.registerRanker('custom', 'not a function' as any);
      }).toThrow('Ranker must be a function');
    });
  });

  describe('Context Building Validation', () => {
    let engine: ContextEngine;

    beforeEach(() => {
      engine = new ContextEngine({
        storageClient,
        embeddingProvider,
      });
    });

    it('should return error for invalid token budget', async () => {
      const result = await engine.buildContext('test query', 'workspace-1', {
        tokenBudget: -100,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('Token budget must be positive');
      }
    });

    it('should return error for nonexistent template', async () => {
      const result = await engine.buildContext('test query', 'workspace-1', {
        template: 'nonexistent',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('template_not_found');
        expect(result.error.message).toContain('Template "nonexistent" not found');
      }
    });

    it('should return error for nonexistent ranker', async () => {
      const result = await engine.buildContext('test query', 'workspace-1', {
        ranker: 'nonexistent',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
        expect(result.error.message).toContain('Ranker "nonexistent" not found');
      }
    });
  });
});
