/**
 * Tests for MAKER Reliability Layer
 * 
 * Tests the red-flagging validation and voting logic
 */

import { describe, it, expect, vi } from 'vitest';
import { makerReliableExtractMemory, type MakerLLMProvider, type ExtractedMemory } from '../maker-extractor.js';

// Mock LLM provider for testing
class MockLLMProvider implements MakerLLMProvider {
    private responses: string[];
    private callIndex = 0;

    constructor(responses: string[]) {
        this.responses = responses;
    }

    async call(_prompt: string, _options?: { temperature?: number; timeout?: number }): Promise<string> {
        const response = this.responses[this.callIndex % this.responses.length];
        this.callIndex++;
        return response;
    }
}

describe('MAKER Reliability Layer', () => {
    describe('Red-Flagging (Validation)', () => {
        it('should accept valid JSON with all required fields', async () => {
            const validResponse = JSON.stringify({
                summary: 'User worked on implementing a login feature for the dashboard.',
                decisions: ['We decided to use OAuth2 for authentication'],
                todos: ['Implement token refresh logic', 'Add error handling']
            });

            const provider = new MockLLMProvider([validResponse, validResponse, validResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBe('User worked on implementing a login feature for the dashboard.');
            expect(result?.decisions).toHaveLength(1);
            expect(result?.todos).toHaveLength(2);
        });

        it('should strip markdown code fences from responses', async () => {
            const responseWithFences = '```json\n' + JSON.stringify({
                summary: 'User worked on implementing a login feature.',
                decisions: ['Decided to use OAuth2'],
                todos: ['Implement refresh logic']
            }) + '\n```';

            const provider = new MockLLMProvider([responseWithFences, responseWithFences, responseWithFences]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBe('User worked on implementing a login feature.');
        });

        it('should reject responses with missing summary', async () => {
            const invalidResponse = JSON.stringify({
                decisions: ['Some decision'],
                todos: ['Some todo']
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject responses with non-string summary', async () => {
            const invalidResponse = JSON.stringify({
                summary: 123,
                decisions: [],
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject responses with non-array decisions', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'This is a valid summary but decisions is wrong',
                decisions: 'not an array',
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject responses with non-array todos', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'This is a valid summary but todos is wrong',
                decisions: [],
                todos: 'not an array'
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject summaries that are too short', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'Too short',  // Less than 20 chars
                decisions: ['Some decision'],
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject summaries that are too long', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'a'.repeat(1501),  // More than 1500 chars
                decisions: [],
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject responses with insufficient content', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'Very short summary.',  // Less than 50 chars with no decisions/todos
                decisions: [],
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject responses with non-string array items', async () => {
            const invalidResponse = JSON.stringify({
                summary: 'Valid summary that is long enough for the validation',
                decisions: ['Valid decision', 123, 'Another valid'],
                todos: []
            });

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });

        it('should reject malformed JSON', async () => {
            const invalidResponse = '{this is not valid json}';

            const provider = new MockLLMProvider([invalidResponse, invalidResponse, invalidResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).toBeNull();
        });
    });

    describe('Voting (Consensus Selection)', () => {
        it('should pick candidate with most overlap when all are valid', async () => {
            const response1 = JSON.stringify({
                summary: 'User implemented authentication using OAuth2 and JWT tokens.',
                decisions: ['Use OAuth2', 'Store tokens in secure cookies'],
                todos: ['Implement refresh logic', 'Add error handling']
            });

            const response2 = JSON.stringify({
                summary: 'User set up OAuth2 authentication with JWT token storage.',
                decisions: ['Use OAuth2', 'Store tokens in secure cookies'],  // Same as response1
                todos: ['Implement refresh logic', 'Write tests']
            });

            const response3 = JSON.stringify({
                summary: 'User working on login with different approach.',
                decisions: ['Try different auth method'],  // Different
                todos: ['Research alternatives']  // Different
            });

            const provider = new MockLLMProvider([response1, response2, response3]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            // Should pick response1 or response2 since they have more overlap
            expect(result?.decisions).toContain('Use OAuth2');
            expect(result?.decisions).toContain('Store tokens in secure cookies');
        });

        it('should return single candidate when only one is valid', async () => {
            const validResponse = JSON.stringify({
                summary: 'User worked on implementing a complex authentication system.',
                decisions: ['Use OAuth2'],
                todos: ['Implement refresh logic']
            });

            const invalidResponse1 = 'malformed json';
            const invalidResponse2 = JSON.stringify({ summary: 'short' });

            const provider = new MockLLMProvider([validResponse, invalidResponse1, invalidResponse2]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBe('User worked on implementing a complex authentication system.');
        });

        it('should handle case where all microagents produce identical outputs', async () => {
            const identicalResponse = JSON.stringify({
                summary: 'User implemented OAuth2 authentication for the application.',
                decisions: ['Use OAuth2 for authentication'],
                todos: ['Add token refresh', 'Implement logout']
            });

            const provider = new MockLLMProvider([identicalResponse, identicalResponse, identicalResponse]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBe('User implemented OAuth2 authentication for the application.');
            expect(result?.decisions).toHaveLength(1);
            expect(result?.todos).toHaveLength(2);
        });

        it('should handle mixed valid and invalid responses', async () => {
            const valid1 = JSON.stringify({
                summary: 'User worked on authentication system with OAuth2 support.',
                decisions: ['Use OAuth2', 'Store in cookies'],
                todos: ['Add refresh logic']
            });

            const valid2 = JSON.stringify({
                summary: 'User implemented OAuth2 authentication and cookie storage.',
                decisions: ['Use OAuth2', 'Store in cookies'],  // High overlap with valid1
                todos: ['Add refresh logic', 'Write tests']
            });

            const invalid = 'bad json';

            const provider = new MockLLMProvider([valid1, invalid, valid2]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.decisions).toContain('Use OAuth2');
        });
    });

    describe('Microagent Orchestration', () => {
        it('should call LLM provider 3 times by default', async () => {
            const mockCall = vi.fn().mockResolvedValue(JSON.stringify({
                summary: 'User worked on implementing OAuth2 authentication system.',
                decisions: ['Use OAuth2'],
                todos: ['Implement refresh']
            }));

            const provider: MakerLLMProvider = { call: mockCall };

            await makerReliableExtractMemory('test source', provider);

            expect(mockCall).toHaveBeenCalledTimes(3);
        });

        it('should pass correct parameters to LLM provider', async () => {
            const mockCall = vi.fn().mockResolvedValue(JSON.stringify({
                summary: 'User worked on implementing OAuth2 authentication system.',
                decisions: [],
                todos: []
            }));

            const provider: MakerLLMProvider = { call: mockCall };

            await makerReliableExtractMemory('test source text', provider);

            expect(mockCall).toHaveBeenCalledWith(
                expect.stringContaining('test source text'),
                expect.objectContaining({
                    temperature: 0.4,
                    timeout: 10000
                })
            );
        });

        it('should handle partial failures gracefully', async () => {
            let callCount = 0;
            const mockCall = vi.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('Microagent 2 failed');
                }
                return JSON.stringify({
                    summary: 'User worked on implementing OAuth2 authentication system.',
                    decisions: ['Use OAuth2'],
                    todos: ['Implement refresh']
                });
            });

            const provider: MakerLLMProvider = { call: mockCall };
            const result = await makerReliableExtractMemory('test source', provider);

            expect(mockCall).toHaveBeenCalledTimes(3);
            expect(result).not.toBeNull();  // Should still succeed with 2/3
        });

        it('should return null when all microagents fail', async () => {
            const mockCall = vi.fn().mockRejectedValue(new Error('All failed'));

            const provider: MakerLLMProvider = { call: mockCall };
            const result = await makerReliableExtractMemory('test source', provider);

            expect(mockCall).toHaveBeenCalledTimes(3);
            expect(result).toBeNull();
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty decisions and todos arrays', async () => {
            const response = JSON.stringify({
                summary: 'User reviewed the existing authentication architecture and discussed potential improvements.',
                decisions: [],
                todos: []
            });

            const provider = new MockLLMProvider([response, response, response]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.decisions).toEqual([]);
            expect(result?.todos).toEqual([]);
        });

        it('should handle very long valid summaries', async () => {
            const longSummary = 'a'.repeat(1499);  // Just under the 1500 char limit
            const response = JSON.stringify({
                summary: longSummary,
                decisions: ['Some decision'],
                todos: []
            });

            const provider = new MockLLMProvider([response, response, response]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBe(longSummary);
        });

        it('should handle unicode characters in content', async () => {
            const response = JSON.stringify({
                summary: 'User worked on implementing OAuth2 authentication with 中文字符 and émojis 🎉',
                decisions: ['Use OAuth2 with unicode support 中文'],
                todos: ['Test unicode handling 🚀']
            });

            const provider = new MockLLMProvider([response, response, response]);
            const result = await makerReliableExtractMemory('test source text', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toContain('中文字符');
            expect(result?.summary).toContain('🎉');
        });
    });
});
