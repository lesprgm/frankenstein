/**
 * Integration test for MAKER Reliability Layer
 * 
 * Tests the full MAKER flow: microagents → validation → voting → final output
 * This is an E2E test within the MemoryLayer package (no Ghost backend dependency)
 */

import { describe, it, expect } from 'vitest';
import { makerReliableExtractMemory, type MakerLLMProvider } from '../maker-extractor.js';

describe('MAKER Reliability Layer - E2E Integration', () => {
    describe('Full MAKER Flow (Microagents → Validation → Voting)', () => {
        it('should successfully extract consensus memory from 3 varied but valid responses', async () => {
            let callCount = 0;
            const provider: MakerLLMProvider = {
                call: async () => {
                    const responses = [
                        // Microagent 1: Detailed with 2 decisions, 3 todos
                        JSON.stringify({
                            summary: 'User worked on implementing OAuth2 authentication flow with JWT token management for the application.',
                            decisions: [
                                'We decided to use OAuth2 for authentication',
                                'Chose to store JWT tokens in secure HTTP-only cookies'
                            ],
                            todos: [
                                'Implement token refresh logic',
                                'Add error handling for expired tokens',
                                'Write integration tests for auth flow'
                            ]
                        }),

                        // Microagent 2: Similar but with different wording (high overlap)
                        JSON.stringify({
                            summary: 'User implemented OAuth2 authentication with JWT tokens stored in secure cookies.',
                            decisions: [
                                'We decided to use OAuth2 for authentication',  // Same as agent 1
                                'Chose to store JWT tokens in secure HTTP-only cookies'  // Same as agent 1
                            ],
                            todos: [
                                'Implement token refresh logic',  // Same as agent 1
                                'Write unit tests for authentication module'  // Different from agent 1
                            ]
                        }),

                        // Microagent 3: Different emphasis, less overlap
                        JSON.stringify({
                            summary: 'User set up authentication system focusing on security best practices for token storage.',
                            decisions: [
                                'Use secure cookie storage for authentication tokens'  // Different wording
                            ],
                            todos: [
                                'Review security audit results',  // Different
                                'Add rate limiting to auth endpoints'  // Different
                            ]
                        })
                    ];

                    const response = responses[callCount % 3];
                    callCount++;
                    return response;
                }
            };

            const result = await makerReliableExtractMemory(
                'User: Can you help me set up OAuth2?\nAssistant: Yes, I can help you implement OAuth2 authentication.',
                provider
            );

            // Verify MAKER selected a consensus result
            expect(result).not.toBeNull();
            expect(result?.summary).toBeDefined();
            expect(result?.summary.length).toBeGreaterThan(20);

            // Should pick agent 1 or 2 since they have highest overlap
            expect(result?.decisions).toContain('We decided to use OAuth2 for authentication');
            expect(result?.decisions.length).toBeGreaterThanOrEqual(1);
            expect(result?.todos.length).toBeGreaterThanOrEqual(1);
        });

        it('should handle mix of valid and invalid responses (2 valid, 1 malformed)', async () => {
            let callCount = 0;
            const provider: MakerLLMProvider = {
                call: async () => {
                    callCount++;

                    if (callCount === 2) {
                        // Second call returns malformed JSON
                        return '{invalid json, missing quotes}';
                    }

                    // First and third calls return valid JSON
                    return JSON.stringify({
                        summary: 'User worked on implementing a new feature for the dashboard with React components.',
                        decisions: ['Use React hooks for state management'],
                        todos: ['Create component tests', 'Add PropTypes validation']
                    });
                }
            };

            const result = await makerReliableExtractMemory('test source', provider);

            // Should still succeed with 2/3 valid responses
            expect(result).not.toBeNull();
            expect(result?.summary).toContain('dashboard');
            expect(result?.decisions).toHaveLength(1);
            expect(result?.todos).toHaveLength(2);
        });

        it('should reject all responses when all are below quality threshold', async () => {
            const provider: MakerLLMProvider = {
                call: async () => {
                    // All responses are too short
                    return JSON.stringify({
                        summary: 'Too short',  // Less than 20 chars
                        decisions: [],
                        todos: []
                    });
                }
            };

            const result = await makerReliableExtractMemory('test', provider);

            // Should return null when all fail validation
            expect(result).toBeNull();
        });

        it('should handle microagent timeouts gracefully', async () => {
            let callCount = 0;
            const provider: MakerLLMProvider = {
                call: async () => {
                    callCount++;

                    if (callCount === 1) {
                        // First call times out
                        await new Promise(resolve => setTimeout(resolve, 100));
                        throw new Error('Timeout');
                    }

                    // Other calls succeed
                    return JSON.stringify({
                        summary: 'User worked on implementing timeout handling for network requests in the application.',
                        decisions: ['Add timeout configuration'],
                        todos: ['Test timeout scenarios']
                    });
                }
            };

            const result = await makerReliableExtractMemory('test', provider);

            // Should still succeed with 2/3 responses
            expect(result).not.toBeNull();
            expect(result?.summary).toContain('timeout');
        });
    });

    describe('Real-world Scenarios', () => {
        it('should extract session memory from actual conversation text', async () => {
            const conversationText = `
User: I want to redesign the authentication flow. We should use OAuth2 with JWT tokens.
Assistant: Great idea! I can help you implement OAuth2 authentication with JWT tokens. 
We'll need to set up the OAuth provider, implement token validation, and handle refresh logic.
User: Yes, and make sure tokens are stored securely.
Assistant: Absolutely. We'll store JWT tokens in HTTP-only cookies to prevent XSS attacks.
      `.trim();

            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'User discussed redesigning the authentication system to use OAuth2 with JWT tokens stored in secure HTTP-only cookies.',
                        decisions: [
                            'Decided to implement OAuth2 for authentication',
                            'Chose to use JWT tokens',
                            'Agreed to store tokens in HTTP-only cookies for security'
                        ],
                        todos: [
                            'Set up OAuth provider integration',
                            'Implement token validation logic',
                            'Handle token refresh mechanism',
                            'Add security tests for XSS prevention'
                        ]
                    });
                }
            };

            const result = await makerReliableExtractMemory(conversationText, provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toContain('OAuth2');
            expect(result?.summary).toContain('JWT');
            expect(result?.decisions.length).toBeGreaterThan(0);
            expect(result?.todos.length).toBeGreaterThan(0);
        });

        it('should extract decisions and todos from technical discussion', async () => {
            const technicalDiscussion = `
User: For the database layer, should we use PostgreSQL or MongoDB?
Assistant: Based on your requirements for ACID compliance and complex queries, 
I recommend PostgreSQL. It has better support for joins and transactions.
User: Okay, let's go with PostgreSQL. We also need to set up connection pooling.
Assistant: Good idea. I'll help you configure connection pooling with pgBouncer.
      `.trim();

            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'User and assistant discussed database selection, deciding on PostgreSQL for ACID compliance and planning to implement connection pooling with pgBouncer.',
                        decisions: [
                            'Decided to use PostgreSQL instead of MongoDB',
                            'Agreed to implement connection pooling'
                        ],
                        todos: [
                            'Set up PostgreSQL database',
                            'Configure pgBouncer for connection pooling',
                            'Write database migration scripts'
                        ]
                    });
                }
            };

            const result = await makerReliableExtractMemory(technicalDiscussion, provider);

            expect(result).not.toBeNull();
            expect(result?.decisions).toContain('Decided to use PostgreSQL instead of MongoDB');
            expect(result?.todos.some(t => t.includes('pgBouncer'))).toBe(true);
        });

        it('should handle conversations with no clear decisions or todos', async () => {
            const casualDiscussion = `
User: Can you explain how OAuth2 works?
Assistant: OAuth2 is an authorization framework that allows third-party applications to access user data without exposing passwords.
      `.trim();

            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'User asked for an explanation of OAuth2, and the assistant provided an overview of the authorization framework.',
                        decisions: [],  // No decisions made
                        todos: []  // No action items
                    });
                }
            };

            const result = await makerReliableExtractMemory(casualDiscussion, provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toContain('OAuth2');
            expect(result?.decisions).toEqual([]);
            expect(result?.todos).toEqual([]);
        });
    });
});
