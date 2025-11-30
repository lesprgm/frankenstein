import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIMakerProvider } from '../openai-maker-provider';

// Mock the entire OpenAI module
const mockCreate = vi.fn();

vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        })),
    };
});

describe('OpenAIMakerProvider', () => {
    let provider: OpenAIMakerProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIMakerProvider('test-api-key', undefined, 'gpt-4o-mini');
    });

    it('should successfully call OpenAI and return response', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: '{"summary": "Test summary", "decisions": [], "todos": []}',
                    },
                },
            ],
        };

        mockCreate.mockResolvedValue(mockResponse);

        const result = await provider.call('Test prompt', { temperature: 0.4, timeout: 5000 });

        expect(result).toBe('{"summary": "Test summary", "decisions": [], "todos": []}');
        expect(mockCreate).toHaveBeenCalledWith(
            {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Test prompt' }],
                temperature: 0.4,
            },
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it('should use default temperature and timeout if not provided', async () => {
        const mockResponse = {
            choices: [{ message: { content: 'Response' } }],
        };

        mockCreate.mockResolvedValue(mockResponse);

        await provider.call('Test prompt');

        expect(mockCreate).toHaveBeenCalledWith(
            {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Test prompt' }],
                temperature: 0.4, // default
            },
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it('should return empty string if response has no content', async () => {
        const mockResponse = {
            choices: [{ message: { content: null } }],
        };

        mockCreate.mockResolvedValue(mockResponse);

        const result = await provider.call('Test prompt');

        expect(result).toBe('');
    });

    it('should throw error on API failure', async () => {
        const apiError = new Error('API Error');
        mockCreate.mockRejectedValue(apiError);

        await expect(provider.call('Test prompt')).rejects.toThrow('API Error');
    });

    it('should handle timeout gracefully', async () => {
        // Mock a slow response that respects abort signal
        mockCreate.mockImplementation((_params, options) => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve({ choices: [{ message: { content: 'Late response' } }] });
                }, 1000);

                // Listen for abort
                if (options?.signal) {
                    options.signal.addEventListener('abort', () => {
                        clearTimeout(timeout);
                        reject(new Error('Request aborted'));
                    });
                }
            });
        });

        // Request with 100ms timeout should abort and throw
        await expect(provider.call('Test prompt', { timeout: 100 })).rejects.toThrow();
    }, 2000); // Give the test itself 2 seconds
});
