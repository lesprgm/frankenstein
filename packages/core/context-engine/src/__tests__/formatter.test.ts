/**
 * Unit tests for ContextFormatter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextFormatter } from '../formatter';
import { CharacterTokenizer, TiktokenTokenizer } from '../tokenizer';
import { DEFAULT_TEMPLATES } from '../templates';
import type { SearchResult, ContextTemplate } from '../types';
import type { Memory } from '@memorylayer/storage';

describe('ContextFormatter', () => {
  let formatter: ContextFormatter;

  // Helper function to create test memories
  const createMemory = (
    id: string,
    content: string,
    type: string = 'fact',
    confidence: number = 0.8
  ): Memory => ({
    id,
    workspace_id: 'test-workspace',
    conversation_id: 'test-conversation',
    type: type as any,
    content,
    confidence,
    metadata: {},
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
  });

  // Helper function to create test search results
  const createSearchResult = (
    id: string,
    content: string,
    score: number = 0.9,
    rank?: number
  ): SearchResult => ({
    memory: createMemory(id, content),
    score,
    rank,
  });

  beforeEach(() => {
    // Use CharacterTokenizer for predictable testing
    formatter = new ContextFormatter(new CharacterTokenizer());
  });

  describe('format', () => {
    it('should format memories with chat template', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'First memory'),
        createSearchResult('2', 'Second memory'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, 1000);

      expect(result.context).toContain('Relevant context from past conversations:');
      expect(result.context).toContain('- First memory');
      expect(result.context).toContain('- Second memory');
      expect(result.template).toBe('chat');
      expect(result.truncated).toBe(false);
    });

    it('should format memories with detailed template', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Test content', 0.85),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.detailed, 1000);

      expect(result.context).toContain('Relevant memories:');
      expect(result.context).toContain('[fact]');
      expect(result.context).toContain('Test content');
      expect(result.context).toContain('confidence: 0.80');
      expect(result.context).toContain('2024-01-01');
      expect(result.template).toBe('detailed');
    });

    it('should format memories with summary template', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'First'),
        createSearchResult('2', 'Second'),
        createSearchResult('3', 'Third'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.summary, 1000);

      expect(result.context).toContain('Key information:');
      expect(result.context).toContain('First | Second | Third');
      expect(result.template).toBe('summary');
    });

    it('should format empty memories array', () => {
      const result = formatter.format([], DEFAULT_TEMPLATES.chat, 1000);

      expect(result.context).toContain('Relevant context from past conversations:');
      expect(result.memories).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.tokenCount).toBeGreaterThan(0); // Header and footer still count
    });

    it('should handle template without header', () => {
      const template: ContextTemplate = {
        name: 'no-header',
        memoryFormat: '{{content}}',
        separator: '\n',
        includeMetadata: false,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toBe('Content');
    });

    it('should handle template without footer', () => {
      const template: ContextTemplate = {
        name: 'no-footer',
        header: 'Header\n',
        memoryFormat: '{{content}}',
        separator: '\n',
        includeMetadata: false,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toBe('Header\nContent');
    });

    it('should throw error for invalid template', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      expect(() => {
        formatter.format(memories, null as any, 1000);
      }).toThrow('Template is required');
    });

    it('should throw error for template without memoryFormat', () => {
      const template = {
        name: 'invalid',
        separator: '\n',
        includeMetadata: false,
      } as any;

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      expect(() => {
        formatter.format(memories, template, 1000);
      }).toThrow('Template memoryFormat is required');
    });

    it('should throw error for invalid token budget', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      expect(() => {
        formatter.format(memories, DEFAULT_TEMPLATES.chat, 0);
      }).toThrow('Token budget must be positive');

      expect(() => {
        formatter.format(memories, DEFAULT_TEMPLATES.chat, -100);
      }).toThrow('Token budget must be positive');
    });

    it('should throw error for non-array memories', () => {
      expect(() => {
        formatter.format('not an array' as any, DEFAULT_TEMPLATES.chat, 1000);
      }).toThrow('Memories must be an array');
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens using CharacterTokenizer', () => {
      const text = 'This is a test'; // 14 characters
      const tokens = formatter.estimateTokens(text);

      // CharacterTokenizer: 1 token ≈ 4 characters
      expect(tokens).toBe(Math.ceil(14 / 4)); // 4 tokens
    });

    it('should estimate tokens for empty string', () => {
      const tokens = formatter.estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should estimate tokens for long text', () => {
      const text = 'a'.repeat(1000); // 1000 characters
      const tokens = formatter.estimateTokens(text);

      expect(tokens).toBe(250); // 1000 / 4
    });

    it('should handle special characters', () => {
      const text = '🎉🎊✨'; // 3 emoji characters
      const tokens = formatter.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('truncateToFit', () => {
    it('should keep all memories when within budget', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Short'),
        createSearchResult('2', 'Text'),
      ];

      const result = formatter.truncateToFit(
        memories,
        DEFAULT_TEMPLATES.chat,
        1000
      );

      expect(result.length).toBe(2);
      expect(result[0].memory.id).toBe('1');
      expect(result[1].memory.id).toBe('2');
    });

    it('should truncate memories when exceeding budget', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'a'.repeat(100)),
        createSearchResult('2', 'b'.repeat(100)),
        createSearchResult('3', 'c'.repeat(100)),
      ];

      // Small budget that can only fit header + 1-2 memories
      const result = formatter.truncateToFit(
        memories,
        DEFAULT_TEMPLATES.chat,
        50
      );

      expect(result.length).toBeLessThan(3);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should prioritize higher-ranked memories', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Low priority', 0.5, 1),
        createSearchResult('2', 'High priority', 0.9, 3),
        createSearchResult('3', 'Medium priority', 0.7, 2),
      ];

      // Memories should already be sorted by rank in practice
      // truncateToFit keeps them in order
      const result = formatter.truncateToFit(
        memories,
        DEFAULT_TEMPLATES.chat,
        100
      );

      // Should keep memories in the order provided
      expect(result[0].memory.id).toBe('1');
    });

    it('should return empty array for empty input', () => {
      const result = formatter.truncateToFit(
        [],
        DEFAULT_TEMPLATES.chat,
        1000
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when header+footer exceed budget', () => {
      const template: ContextTemplate = {
        name: 'large-overhead',
        header: 'a'.repeat(1000),
        memoryFormat: '{{content}}',
        separator: '\n',
        footer: 'b'.repeat(1000),
        includeMetadata: false,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.truncateToFit(memories, template, 100);

      expect(result).toEqual([]);
    });

    it('should account for separator tokens', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'First'),
        createSearchResult('2', 'Second'),
      ];

      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: '{{content}}',
        separator: ' | ', // 3 characters = ~1 token
        includeMetadata: false,
      };

      const result = formatter.truncateToFit(memories, template, 10);

      // Should account for separator between memories
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle null or invalid memories gracefully', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Valid'),
        null as any,
        { memory: null, score: 0.5 } as any,
        createSearchResult('2', 'Also valid'),
      ];

      const result = formatter.truncateToFit(
        memories,
        DEFAULT_TEMPLATES.chat,
        1000
      );

      // Should skip invalid memories
      expect(result.length).toBe(2);
      expect(result[0].memory.id).toBe('1');
      expect(result[1].memory.id).toBe('2');
    });
  });

  describe('template variable substitution', () => {
    it('should substitute {{content}} variable', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Content: {{content}}',
        separator: '\n',
        includeMetadata: false,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Test content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Content: Test content');
    });

    it('should substitute {{type}} variable when includeMetadata is true', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Type: {{type}}',
        separator: '\n',
        includeMetadata: true,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Type: fact');
    });

    it('should remove {{type}} variable when includeMetadata is false', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Type: {{type}} - {{content}}',
        separator: '\n',
        includeMetadata: false,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Type:  - Content');
      expect(result.context).not.toContain('fact');
    });

    it('should substitute {{confidence}} variable when includeMetadata is true', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Confidence: {{confidence}}',
        separator: '\n',
        includeMetadata: true,
      };

      const memory = createMemory('1', 'Content', 'fact', 0.85);
      const memories: SearchResult[] = [
        { memory, score: 0.9 },
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Confidence: 0.85');
    });

    it('should substitute {{timestamp}} variable when includeMetadata is true', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Time: {{timestamp}}',
        separator: '\n',
        includeMetadata: true,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Time: 2024-01-01');
    });

    it('should substitute {{score}} variable when includeMetadata is true', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: 'Score: {{score}}',
        separator: '\n',
        includeMetadata: true,
      };

      const memories: SearchResult[] = [
        createSearchResult('1', 'Content', 0.876),
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Score: 0.876');
    });

    it('should substitute multiple variables', () => {
      const template: ContextTemplate = {
        name: 'test',
        memoryFormat: '[{{type}}] {{content}} ({{confidence}}, {{score}})',
        separator: '\n',
        includeMetadata: true,
      };

      const memory = createMemory('1', 'Test', 'decision', 0.95);
      const memories: SearchResult[] = [
        { memory, score: 0.88 },
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('[decision]');
      expect(result.context).toContain('Test');
      expect(result.context).toContain('0.95');
      expect(result.context).toContain('0.880');
    });
  });

  describe('metadata inclusion/exclusion', () => {
    it('should include metadata when includeMetadata is true', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.detailed, 1000);

      expect(result.context).toContain('[fact]');
      expect(result.context).toContain('confidence:');
      expect(result.context).toContain('2024-01-01');
    });

    it('should exclude metadata when includeMetadata is false', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Content'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, 1000);

      expect(result.context).not.toContain('[fact]');
      expect(result.context).not.toContain('confidence:');
      expect(result.context).not.toContain('2024-01-01');
    });

    it('should handle custom template with selective metadata', () => {
      const template: ContextTemplate = {
        name: 'selective',
        memoryFormat: '{{content}} ({{confidence}})',
        separator: '\n',
        includeMetadata: true,
      };

      const memory = createMemory('1', 'Test', 'fact', 0.75);
      const memories: SearchResult[] = [
        { memory, score: 0.9 },
      ];

      const result = formatter.format(memories, template, 1000);

      expect(result.context).toContain('Test');
      expect(result.context).toContain('0.75');
      expect(result.context).not.toContain('[fact]'); // Not in template
    });
  });

  describe('token counting accuracy', () => {
    it('should return accurate token count for formatted context', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Test'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, 1000);

      // Verify token count matches actual content
      const expectedTokens = formatter.estimateTokens(result.context);
      expect(result.tokenCount).toBe(expectedTokens);
    });

    it('should count tokens for complex template', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'First memory'),
        createSearchResult('2', 'Second memory'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.detailed, 1000);

      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.tokenCount).toBe(formatter.estimateTokens(result.context));
    });
  });

  describe('integration with TiktokenTokenizer', () => {
    it('should work with TiktokenTokenizer', () => {
      const tiktokenFormatter = new ContextFormatter(
        new TiktokenTokenizer('gpt-3.5-turbo')
      );

      const memories: SearchResult[] = [
        createSearchResult('1', 'This is a test message'),
      ];

      const result = tiktokenFormatter.format(
        memories,
        DEFAULT_TEMPLATES.chat,
        1000
      );

      expect(result.context).toContain('This is a test message');
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('truncation behavior', () => {
    it('should set truncated flag when memories are truncated', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'a'.repeat(100)),
        createSearchResult('2', 'b'.repeat(100)),
        createSearchResult('3', 'c'.repeat(100)),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, 50);

      expect(result.truncated).toBe(true);
      expect(result.memories.length).toBeLessThan(3);
    });

    it('should not set truncated flag when all memories fit', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'Short'),
      ];

      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, 1000);

      expect(result.truncated).toBe(false);
      expect(result.memories.length).toBe(1);
    });

    it('should respect token budget strictly', () => {
      const memories: SearchResult[] = [
        createSearchResult('1', 'a'.repeat(100)),
        createSearchResult('2', 'b'.repeat(100)),
      ];

      const budget = 50;
      const result = formatter.format(memories, DEFAULT_TEMPLATES.chat, budget);

      expect(result.tokenCount).toBeLessThanOrEqual(budget);
    });
  });
});
