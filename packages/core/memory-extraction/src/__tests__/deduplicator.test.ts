/**
 * Tests for MemoryDeduplicator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDeduplicator } from '../deduplicator.js';
import { ExtractedMemory } from '../types.js';

describe('MemoryDeduplicator', () => {
  let deduplicator: MemoryDeduplicator;

  beforeEach(() => {
    deduplicator = new MemoryDeduplicator();
  });

  describe('generateMemoryId', () => {
    it('should generate stable IDs for identical memories', () => {
      const memory: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue',
        workspace_id: 'workspace-1'
      };

      const id1 = deduplicator.generateMemoryId(memory);
      const id2 = deduplicator.generateMemoryId(memory);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); // SHA-256 hash
    });

    it('should generate different IDs for different content', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue',
        workspace_id: 'workspace-1'
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The grass is green',
        workspace_id: 'workspace-1'
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different types', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'Important information',
        workspace_id: 'workspace-1'
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'decision',
        content: 'Important information',
        workspace_id: 'workspace-1'
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different workspaces', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue',
        workspace_id: 'workspace-1'
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue',
        workspace_id: 'workspace-2'
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).not.toBe(id2);
    });

    it('should generate same ID for content with different whitespace', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The  sky   is blue',
        workspace_id: 'workspace-1'
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue',
        workspace_id: 'workspace-1'
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).toBe(id2);
    });

    it('should generate same ID for content with different casing', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The Sky Is Blue',
        workspace_id: 'workspace-1'
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'the sky is blue',
        workspace_id: 'workspace-1'
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).toBe(id2);
    });

    it('should include entity type and name in ID for entities', () => {
      const memory1: Partial<ExtractedMemory> = {
        type: 'entity',
        content: 'A software company',
        workspace_id: 'workspace-1',
        metadata: {
          entityType: 'organization',
          name: 'Acme Corp'
        }
      };

      const memory2: Partial<ExtractedMemory> = {
        type: 'entity',
        content: 'A software company',
        workspace_id: 'workspace-1',
        metadata: {
          entityType: 'organization',
          name: 'Different Corp'
        }
      };

      const id1 = deduplicator.generateMemoryId(memory1);
      const id2 = deduplicator.generateMemoryId(memory2);

      expect(id1).not.toBe(id2);
    });

    it('should throw error if type is missing', () => {
      const memory: Partial<ExtractedMemory> = {
        content: 'The sky is blue',
        workspace_id: 'workspace-1'
      };

      expect(() => deduplicator.generateMemoryId(memory)).toThrow(
        'Memory must have type, content, and workspace_id to generate ID'
      );
    });

    it('should throw error if content is missing', () => {
      const memory: Partial<ExtractedMemory> = {
        type: 'fact',
        workspace_id: 'workspace-1'
      };

      expect(() => deduplicator.generateMemoryId(memory)).toThrow(
        'Memory must have type, content, and workspace_id to generate ID'
      );
    });

    it('should throw error if workspace_id is missing', () => {
      const memory: Partial<ExtractedMemory> = {
        type: 'fact',
        content: 'The sky is blue'
      };

      expect(() => deduplicator.generateMemoryId(memory)).toThrow(
        'Memory must have type, content, and workspace_id to generate ID'
      );
    });
  });

  describe('normalizeContent', () => {
    it('should convert to lowercase', () => {
      const result = deduplicator.normalizeContent('The Sky Is BLUE');
      expect(result).toBe('the sky is blue');
    });

    it('should trim whitespace', () => {
      const result = deduplicator.normalizeContent('  The sky is blue  ');
      expect(result).toBe('the sky is blue');
    });

    it('should remove extra whitespace', () => {
      const result = deduplicator.normalizeContent('The  sky   is    blue');
      expect(result).toBe('the sky is blue');
    });

    it('should handle newlines', () => {
      const result = deduplicator.normalizeContent('The sky\nis\nblue');
      expect(result).toBe('the sky is blue');
    });

    it('should handle tabs', () => {
      const result = deduplicator.normalizeContent('The\tsky\tis\tblue');
      expect(result).toBe('the sky is blue');
    });

    it('should handle mixed whitespace', () => {
      const result = deduplicator.normalizeContent('  The  \n sky \t is   blue  ');
      expect(result).toBe('the sky is blue');
    });

    it('should handle empty string', () => {
      const result = deduplicator.normalizeContent('');
      expect(result).toBe('');
    });

    it('should handle whitespace-only string', () => {
      const result = deduplicator.normalizeContent('   \n\t  ');
      expect(result).toBe('');
    });
  });

  describe('areDuplicates', () => {
    it('should return true for identical memories', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(true);
    });

    it('should return true for memories with different whitespace', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The  sky   is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        content: 'The sky is blue'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(true);
    });

    it('should return true for memories with different casing', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The Sky Is Blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        content: 'the sky is blue'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(true);
    });

    it('should return false for different types', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'Important information',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        type: 'decision'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(false);
    });

    it('should return false for different workspaces', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        workspace_id: 'workspace-2'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(false);
    });

    it('should return false for different content', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        content: 'The grass is green'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(false);
    });

    it('should check entity type for entity memories', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'entity',
        content: 'A software company',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {
          entityType: 'organization',
          name: 'Acme Corp'
        },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        metadata: {
          entityType: 'person',
          name: 'Acme Corp'
        }
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(false);
    });

    it('should check entity name for entity memories', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'entity',
        content: 'A software company',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {
          entityType: 'organization',
          name: 'Acme Corp'
        },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        metadata: {
          entityType: 'organization',
          name: 'Different Corp'
        }
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(false);
    });

    it('should normalize entity names when comparing', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'entity',
        content: 'A software company',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {
          entityType: 'organization',
          name: 'Acme Corp'
        },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        metadata: {
          entityType: 'organization',
          name: 'ACME  CORP'
        }
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(true);
    });

    it('should handle entities without name metadata', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'entity',
        content: 'A software company',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {
          entityType: 'organization'
        },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2'
      };

      expect(deduplicator.areDuplicates(memory1, memory2)).toBe(true);
    });
  });

  describe('deduplicate', () => {
    it('should remove exact duplicates', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        source_message_ids: ['msg-2']
      };

      const result = deduplicator.deduplicate([memory1, memory2]);

      expect(result).toHaveLength(1);
      expect(result[0].source_message_ids).toContain('msg-1');
      expect(result[0].source_message_ids).toContain('msg-2');
    });

    it('should keep non-duplicate memories', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        content: 'The grass is green',
        source_message_ids: ['msg-2']
      };

      const result = deduplicator.deduplicate([memory1, memory2]);

      expect(result).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = deduplicator.deduplicate([]);
      expect(result).toHaveLength(0);
    });

    it('should handle single memory', () => {
      const memory: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const result = deduplicator.deduplicate([memory]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(memory);
    });

    it('should deduplicate across multiple conversations', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        conversation_id: 'conv-2',
        source_message_ids: ['msg-2']
      };

      const result = deduplicator.deduplicate([memory1, memory2]);

      expect(result).toHaveLength(1);
      expect(result[0].source_message_ids).toHaveLength(2);
    });

    it('should keep highest confidence when merging', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.7,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: { source: 'first' },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        confidence: 0.9,
        source_message_ids: ['msg-2'],
        metadata: { source: 'second' }
      };

      const result = deduplicator.deduplicate([memory1, memory2]);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(0.9);
    });

    it('should handle multiple duplicates of same memory', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        source_message_ids: ['msg-2']
      };

      const memory3: ExtractedMemory = {
        ...memory1,
        id: 'id3',
        source_message_ids: ['msg-3']
      };

      const result = deduplicator.deduplicate([memory1, memory2, memory3]);

      expect(result).toHaveLength(1);
      expect(result[0].source_message_ids).toHaveLength(3);
      expect(result[0].source_message_ids).toContain('msg-1');
      expect(result[0].source_message_ids).toContain('msg-2');
      expect(result[0].source_message_ids).toContain('msg-3');
    });
  });

  describe('merge', () => {
    it('should keep highest confidence', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.7,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        confidence: 0.9,
        source_message_ids: ['msg-2']
      };

      const merged = deduplicator.merge([memory1, memory2]);

      expect(merged.confidence).toBe(0.9);
    });

    it('should merge source_message_ids', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1', 'msg-2'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        source_message_ids: ['msg-2', 'msg-3']
      };

      const merged = deduplicator.merge([memory1, memory2]);

      expect(merged.source_message_ids).toHaveLength(3);
      expect(merged.source_message_ids).toContain('msg-1');
      expect(merged.source_message_ids).toContain('msg-2');
      expect(merged.source_message_ids).toContain('msg-3');
    });

    it('should sort merged source_message_ids', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-3'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        source_message_ids: ['msg-1']
      };

      const memory3: ExtractedMemory = {
        ...memory1,
        id: 'id3',
        source_message_ids: ['msg-2']
      };

      const merged = deduplicator.merge([memory1, memory2, memory3]);

      expect(merged.source_message_ids).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    it('should merge metadata from highest confidence memory', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.7,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: { field1: 'value1', field2: 'value2' },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        confidence: 0.9,
        source_message_ids: ['msg-2'],
        metadata: { field1: 'different', field3: 'value3' }
      };

      const merged = deduplicator.merge([memory1, memory2]);

      expect(merged.metadata.field1).toBe('different'); // From highest confidence
      expect(merged.metadata.field3).toBe('value3');
    });

    it('should fill missing metadata fields from lower confidence memories', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: { field1: 'value1' },
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        confidence: 0.7,
        source_message_ids: ['msg-2'],
        metadata: { field1: 'different', field2: 'value2' }
      };

      const merged = deduplicator.merge([memory1, memory2]);

      expect(merged.metadata.field1).toBe('value1'); // From highest confidence
      expect(merged.metadata.field2).toBe('value2'); // Filled from lower confidence
    });

    it('should use earliest created_at timestamp', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-02T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        ...memory1,
        id: 'id2',
        source_message_ids: ['msg-2'],
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory3: ExtractedMemory = {
        ...memory1,
        id: 'id3',
        source_message_ids: ['msg-3'],
        created_at: '2024-01-03T00:00:00Z'
      };

      const merged = deduplicator.merge([memory1, memory2, memory3]);

      expect(merged.created_at).toBe('2024-01-01T00:00:00Z');
    });

    it('should return single memory unchanged', () => {
      const memory: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: { field: 'value' },
        created_at: '2024-01-01T00:00:00Z'
      };

      const merged = deduplicator.merge([memory]);

      expect(merged).toEqual(memory);
    });

    it('should throw error for empty array', () => {
      expect(() => deduplicator.merge([])).toThrow('Cannot merge empty array of memories');
    });

    it('should preserve all fields from highest confidence memory', () => {
      const memory1: ExtractedMemory = {
        id: 'id1',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.7,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-1',
        source_message_ids: ['msg-1'],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      };

      const memory2: ExtractedMemory = {
        id: 'id2',
        type: 'fact',
        content: 'The sky is blue',
        confidence: 0.9,
        workspace_id: 'workspace-1',
        conversation_id: 'conv-2',
        source_message_ids: ['msg-2'],
        metadata: {},
        created_at: '2024-01-02T00:00:00Z'
      };

      const merged = deduplicator.merge([memory1, memory2]);

      expect(merged.id).toBe('id2');
      expect(merged.type).toBe('fact');
      expect(merged.content).toBe('The sky is blue');
      expect(merged.confidence).toBe(0.9);
      expect(merged.workspace_id).toBe('workspace-1');
      expect(merged.conversation_id).toBe('conv-2');
    });
  });
});
