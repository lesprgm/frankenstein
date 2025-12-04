/**
 * Tests for ChatCapture main class
 * Requirements: 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.6, 5.7, 7.3, 7.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatCapture } from '../index.js';
import { BaseParser } from '../parsers/base.js';
import { NormalizedConversation } from '../types.js';

describe('ChatCapture', () => {
  let chatCapture: ChatCapture;

  beforeEach(() => {
    chatCapture = new ChatCapture();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const capture = new ChatCapture();
      expect(capture).toBeDefined();
      expect(capture.listProviders()).toContain('openai');
      expect(capture.listProviders()).toContain('anthropic');
    });

    it('should accept custom config', () => {
      const capture = new ChatCapture({
        maxFileSize: 1024,
        maxConversationsPerFile: 10,
        enableAutoDetection: false,
      });
      expect(capture).toBeDefined();
    });
  });

  describe('parseFile', () => {
    it('should parse OpenAI format with explicit provider', async () => {
      const data = {
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 1234567890,
            },
            parent: null,
            children: [],
          },
        },
        title: 'Test',
        create_time: 1234567890,
      };

      const result = await chatCapture.parseFile(
        JSON.stringify(data),
        'openai'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].provider).toBe('openai');
        expect(result.value[0].messages).toHaveLength(1);
      }
    });

    it('should parse ChatGPT HTML export with explicit provider', async () => {
      const htmlExport = `
        <html>
          <body>
            <script>
              var jsonData = [{
                "title": "HTML Explicit",
                "mapping": {
                  "root": { "id": "root", "message": null, "parent": null, "children": ["child-1"] },
                  "child-1": {
                    "id": "child-1",
                    "message": { "id": "m1", "author": { "role": "user" }, "content": { "parts": ["Hi HTML explicit"] }, "create_time": 1 },
                    "parent": "root",
                    "children": []
                  }
                },
                "conversation_id": "html-explicit-1"
              }];
            </script>
          </body>
        </html>
      `;

      const result = await chatCapture.parseFile(htmlExport, 'openai');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].external_id).toBe('html-explicit-1');
        expect(result.value[0].messages[0].content).toBe('Hi HTML explicit');
      }
    });

    it('should parse HTML export when assetsJson follows jsonData', async () => {
      const htmlExport = `
        <html>
          <body>
            <script>
              const jsonData = [{
                "title": "HTML With Assets",
                "mapping": {
                  "root": { "id": "root", "message": null, "parent": null, "children": ["c1"] },
                  "c1": {
                    "id": "c1",
                    "message": { "id": "m1", "author": { "role": "user" }, "content": { "parts": ["Hi assets"] }, "create_time": 1 },
                    "parent": "root",
                    "children": []
                  }
                },
                "conversation_id": "html-assets-1"
              }];
              const assetsJson = {};
            </script>
          </body>
        </html>
      `;

      const result = await chatCapture.parseFile(htmlExport, 'openai');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].external_id).toBe('html-assets-1');
        expect(result.value[0].messages[0].content).toBe('Hi assets');
      }
    });

    it('should return error for unknown provider', async () => {
      const data = { test: 'data' };
      const result = await chatCapture.parseFile(
        JSON.stringify(data),
        'unknown'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('provider_not_found');
      }
    });

    it('should validate file size', async () => {
      const capture = new ChatCapture({ maxFileSize: 10 });
      const largeData = JSON.stringify({ data: 'x'.repeat(1000) });

      const result = await capture.parseFile(largeData, 'openai');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('file_too_large');
      }
    });

    it('should validate conversation count', async () => {
      const capture = new ChatCapture({ maxConversationsPerFile: 1 });
      
      // Create data with multiple conversations
      const data = {
        conversations: [
          {
            mapping: {
              'node-1': {
                id: 'node-1',
                message: {
                  id: 'msg-1',
                  author: { role: 'user' },
                  content: { parts: ['Hello 1'] },
                  create_time: 1234567890,
                },
                parent: null,
                children: [],
              },
            },
            title: 'Test 1',
          },
          {
            mapping: {
              'node-2': {
                id: 'node-2',
                message: {
                  id: 'msg-2',
                  author: { role: 'user' },
                  content: { parts: ['Hello 2'] },
                  create_time: 1234567890,
                },
                parent: null,
                children: [],
              },
            },
            title: 'Test 2',
          },
        ],
      };

      const result = await capture.parseFile(JSON.stringify(data), 'openai');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('too_many_conversations');
      }
    });

    it('should handle invalid JSON', async () => {
      const result = await chatCapture.parseFile('invalid json', 'openai');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('parse_error');
      }
    });

    it('should validate conversations and return errors', async () => {
      // Create a custom parser that returns invalid conversation
      class InvalidParser extends BaseParser {
        readonly provider = 'invalid-test';

        canParse(): boolean {
          return true;
        }

        async parse(): Promise<NormalizedConversation[]> {
          return [
            {
              id: '1',
              provider: 'invalid-test',
              external_id: null,
              title: 'Invalid',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: [], // Invalid: no messages
              raw_metadata: {},
            },
          ];
        }
      }

      chatCapture.registerParser('invalid-test', new InvalidParser());

      const result = await chatCapture.parseFile(
        JSON.stringify({ test: 'data' }),
        'invalid-test'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
      }
    });

    it('should skip invalid conversations with skipInvalid option', async () => {
      // Create a custom parser that returns mixed valid/invalid conversations
      class TestParser extends BaseParser {
        readonly provider = 'test';

        canParse(): boolean {
          return true;
        }

        async parse(): Promise<NormalizedConversation[]> {
          return [
            {
              id: '1',
              provider: 'test',
              external_id: null,
              title: 'Valid',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: [
                {
                  id: 'm1',
                  role: 'user',
                  content: 'Hello',
                  created_at: new Date().toISOString(),
                  raw_metadata: {},
                },
              ],
              raw_metadata: {},
            },
            {
              id: '2',
              provider: 'test',
              external_id: null,
              title: 'Invalid',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: [], // Invalid: no messages
              raw_metadata: {},
            },
          ];
        }
      }

      chatCapture.registerParser('test', new TestParser());

      const result = await chatCapture.parseFile(
        JSON.stringify({ test: 'data' }),
        'test',
        { skipInvalid: true }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].title).toBe('Valid');
      }
    });
  });

  describe('parseFileAuto', () => {
    it('should auto-detect OpenAI format', async () => {
      const data = {
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 1234567890,
            },
            parent: null,
            children: [],
          },
        },
        title: 'Test',
      };

      const result = await chatCapture.parseFileAuto(JSON.stringify(data));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].provider).toBe('openai');
      }
    });

    it('should auto-detect Anthropic format', async () => {
      const data = {
        uuid: 'test-uuid',
        chat_messages: [
          {
            uuid: 'msg-1',
            text: 'Hello',
            sender: 'human',
            created_at: new Date().toISOString(),
          },
        ],
        name: 'Test',
      };

      const result = await chatCapture.parseFileAuto(JSON.stringify(data));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].provider).toBe('anthropic');
      }
    });

    it('should return error for unknown format', async () => {
      const data = { unknown: 'format' };
      const result = await chatCapture.parseFileAuto(JSON.stringify(data));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('detection_failed');
      }
    });

    it('should work with Buffer input', async () => {
      const data = {
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 1234567890,
            },
            parent: null,
            children: [],
          },
        },
      };

      const buffer = Buffer.from(JSON.stringify(data));
      const result = await chatCapture.parseFileAuto(buffer);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].provider).toBe('openai');
      }
    });

    it('should parse ChatGPT HTML export with embedded jsonData', async () => {
      const htmlExport = `
        <html>
          <head><title>ChatGPT Export</title></head>
          <body>
            <script>
              var jsonData = [{
                "title": "HTML Chat",
                "create_time": 1700000000,
                "mapping": {
                  "root": {
                    "id": "root",
                    "message": null,
                    "parent": null,
                    "children": ["child-1"]
                  },
                  "child-1": {
                    "id": "child-1",
                    "message": {
                      "id": "msg-1",
                      "author": { "role": "user" },
                      "content": { "content_type": "text", "parts": ["Hi from HTML"] },
                      "create_time": 1700000000
                    },
                    "parent": "root",
                    "children": ["child-2"]
                  },
                  "child-2": {
                    "id": "child-2",
                    "message": {
                      "id": "msg-2",
                      "author": { "role": "assistant" },
                      "content": { "content_type": "text", "parts": ["Hello!"] },
                      "create_time": 1700000005
                    },
                    "parent": "child-1",
                    "children": []
                  }
                },
                "conversation_id": "html-conv-1"
              }];
            </script>
          </body>
        </html>
      `;

      const result = await chatCapture.parseFileAuto(htmlExport);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].provider).toBe('openai');
        expect(result.value[0].external_id).toBe('html-conv-1');
        expect(result.value[0].title).toBe('HTML Chat');
        expect(result.value[0].messages.map(m => m.content)).toEqual([
          'Hi from HTML',
          'Hello!'
        ]);
      }
    });

    it('should parse ChatGPT HTML export with assetsJson using auto-detect', async () => {
      const htmlExport = `
        <!doctype html>
        <html>
          <body>
            <script>
              // Some comment noise
              let jsonData = [{
                "title": "HTML Auto Assets",
                "mapping": {
                  "root": { "id": "root", "message": null, "parent": null, "children": ["c1"] },
                  "c1": {
                    "id": "c1",
                    "message": { "id": "m1", "author": { "role": "assistant" }, "content": { "parts": ["Auto assets"] }, "create_time": 1 },
                    "parent": "root",
                    "children": []
                  }
                },
                "conversation_id": "html-auto-assets"
              }];
              var assetsJson = {};
            </script>
          </body>
        </html>
      `;

      const result = await chatCapture.parseFileAuto(htmlExport);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].external_id).toBe('html-auto-assets');
        expect(result.value[0].messages[0].content).toBe('Auto assets');
      }
    });
  });

  describe('registerParser', () => {
    it('should register custom parser', () => {
      class CustomParser extends BaseParser {
        readonly provider = 'custom';

        canParse(): boolean {
          return true;
        }

        async parse(): Promise<NormalizedConversation[]> {
          return [];
        }
      }

      chatCapture.registerParser('custom', new CustomParser());
      expect(chatCapture.listProviders()).toContain('custom');
    });

    it('should use registered custom parser', async () => {
      class CustomParser extends BaseParser {
        readonly provider = 'custom';

        canParse(data: unknown): boolean {
          return (
            typeof data === 'object' &&
            data !== null &&
            'custom_field' in data
          );
        }

        async parse(): Promise<NormalizedConversation[]> {
          return [
            {
              id: 'custom-1',
              provider: 'custom',
              external_id: null,
              title: 'Custom Conversation',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: [
                {
                  id: 'msg-1',
                  role: 'user',
                  content: 'Custom message',
                  created_at: new Date().toISOString(),
                  raw_metadata: {},
                },
              ],
              raw_metadata: {},
            },
          ];
        }
      }

      chatCapture.registerParser('custom', new CustomParser());

      const data = { custom_field: 'value' };
      const result = await chatCapture.parseFile(
        JSON.stringify(data),
        'custom'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].provider).toBe('custom');
        expect(result.value[0].title).toBe('Custom Conversation');
      }
    });
  });

  describe('listProviders', () => {
    it('should list default providers', () => {
      const providers = chatCapture.listProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
    });

    it('should include custom providers', () => {
      class CustomParser extends BaseParser {
        readonly provider = 'custom';
        canParse(): boolean {
          return false;
        }
        async parse(): Promise<NormalizedConversation[]> {
          return [];
        }
      }

      chatCapture.registerParser('custom', new CustomParser());
      const providers = chatCapture.listProviders();
      expect(providers).toContain('custom');
    });
  });

  describe('createStreamingBuilder', () => {
    it('should create streaming builder for registered provider', () => {
      const result = chatCapture.createStreamingBuilder('openai', 'conv-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        const state = result.value.getState();
        expect(state.conversationId).toBe('conv-123');
        expect(state.messageCount).toBe(0);
        expect(state.isFinalized).toBe(false);
      }
    });

    it('should return error for unregistered provider', () => {
      const result = chatCapture.createStreamingBuilder('unknown', 'conv-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('provider_not_found');
        expect(result.error.provider).toBe('unknown');
      }
    });

    it('should create builder that can assemble conversations', () => {
      const result = chatCapture.createStreamingBuilder('openai', 'conv-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const builder = result.value;

        // Add a complete message
        builder.addMessage({
          role: 'user',
          content: 'Hello, world!',
        });

        // Check state
        const state = builder.getState();
        expect(state.messageCount).toBe(1);

        // Finalize conversation
        const conversation = builder.finalize({ model: 'gpt-4' });
        expect(conversation.provider).toBe('openai');
        expect(conversation.external_id).toBe('conv-456');
        expect(conversation.messages).toHaveLength(1);
        expect(conversation.messages[0].content).toBe('Hello, world!');
        expect(conversation.raw_metadata.model).toBe('gpt-4');
      }
    });
  });
});
