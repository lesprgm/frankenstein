import { describe, it, expect } from 'vitest';
import { LLMCoordinator } from '../src/services/llm-coordinator.js';
import type { MemoryReference } from '../src/types.js';

describe('LLMCoordinator meta-chatter detection', () => {
  const llm = new LLMCoordinator();

  describe('isMetaChatter detection', () => {
    // Access the private method via any cast for testing
    const isMetaChatter = (text: string) => (llm as any).isMetaChatter(text);

    it('should detect "user asked" patterns', () => {
      expect(isMetaChatter('user asked about the meeting')).toBe(true);
      expect(isMetaChatter('The user asked for information')).toBe(true);
    });

    it('should detect "user was inquiring" patterns', () => {
      expect(isMetaChatter('The user was inquiring about the API redesign')).toBe(true);
      expect(isMetaChatter('user was inquiring about details')).toBe(true);
    });

    it('should detect "the assistant" patterns', () => {
      expect(isMetaChatter('The assistant responded with information')).toBe(true);
      expect(isMetaChatter('The assistant confirmed the meeting time')).toBe(true);
    });

    it('should detect "based on memories" patterns', () => {
      expect(isMetaChatter('Based on the memories I found, Sarah mentioned GraphQL')).toBe(true);
      expect(isMetaChatter('Based on memory, the meeting was Tuesday')).toBe(true);
    });

    it('should detect "did not provide" patterns', () => {
      expect(isMetaChatter('The assistant did not provide the content')).toBe(true);
    });

    it('should NOT flag legitimate responses', () => {
      expect(isMetaChatter('Sarah proposed moving to GraphQL for the API redesign')).toBe(false);
      expect(isMetaChatter('The meeting is scheduled for Tuesday at 3pm')).toBe(false);
      expect(isMetaChatter('I found the document in your Downloads folder')).toBe(false);
    });
  });

  describe('fallback behavior with meta-chatter', () => {
    it('should fall back to memory content when LLM returns meta-chatter', async () => {
      const memories: MemoryReference[] = [
        {
          id: 'mem-1',
          type: 'fact',
          score: 0.9,
          summary: 'Sarah proposed moving to GraphQL during the Tuesday meeting',
          metadata: {},
        },
      ];

      // When no API key is available, it uses fallback
      const response = await llm.generateResponse(
        'What did Sarah say about the API redesign?',
        '',
        memories
      );

      // The response should contain actual content, not meta-commentary
      expect(response.assistant_text.toLowerCase()).not.toContain('the user was inquiring');
      expect(response.assistant_text.toLowerCase()).not.toContain('the assistant responded');
      
      // Should have an info.recall action with the actual memory content
      const recallAction = response.actions.find(a => a.type === 'info.recall');
      expect(recallAction).toBeDefined();
      expect((recallAction?.params as any)?.summary).toContain('Sarah');
    });

    it('should prioritize recall summary over meta-commentary in assistant_text', async () => {
      const memories: MemoryReference[] = [
        {
          id: 'mem-1',
          type: 'fact',
          score: 0.9,
          summary: 'Project deadline extended to March 15th per manager approval',
          metadata: {},
        },
      ];

      const response = await llm.generateResponse(
        'When is the project deadline?',
        '',
        memories
      );

      // The assistant_text should be the actual answer
      expect(response.assistant_text).toContain('March 15');
    });
  });

  describe('direct answer generation', () => {
    it('should generate direct answers without meta-commentary for recall queries', async () => {
      const memories: MemoryReference[] = [
        {
          id: 'mem-1',
          type: 'entity.person',
          score: 0.85,
          summary: 'Sarah Chen - Lead Developer, email: sarah@company.com',
          metadata: { name: 'Sarah Chen', email: 'sarah@company.com' },
        },
      ];

      const response = await llm.generateResponse(
        'What is Sarah\'s email?',
        '',
        memories
      );

      // Should directly answer without meta-framing
      expect(response.assistant_text.toLowerCase()).not.toContain('based on');
      expect(response.assistant_text.toLowerCase()).not.toContain('i found');
      expect(response.assistant_text.toLowerCase()).not.toContain('the user');
    });
  });
});
