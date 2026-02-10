
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MakerStrategy } from '../strategies/maker-strategy.js';
import { makerReliableExtractMemory } from '../maker-extractor.js';
import { NormalizedConversation } from '../types.js';

// Mock the underlying Maker logic
// Note: We mock the path exactly as it is imported in the source file
vi.mock('../maker-extractor.js', () => ({
    makerReliableExtractMemory: vi.fn(),
    MakerLLMProvider: {
        call: vi.fn(), // Just a type carrier, but good to mock if needed
    }
}));

describe('MakerStrategy', () => {
    let strategy: MakerStrategy;

    beforeEach(() => {
        strategy = new MakerStrategy();
        vi.clearAllMocks();
    });

    const mockConversation: NormalizedConversation = {
        id: 'test-conv-1',
        messages: [
            { id: '1', role: 'user', content: 'What should we do about the API?', timestamp: '2023-01-01T10:00:00Z' },
            { id: '2', role: 'assistant', content: 'We should use GraphQL.', timestamp: '2023-01-01T10:00:05Z' }
        ]
    };

    it('should transform NormalizedConversation to sourceText correctly', async () => {
        const mockProvider = {
            complete: vi.fn(),
            completeStructured: vi.fn(),
            completeWithFunctions: vi.fn(),
            name: 'mock',
        };
        const config = {
            memoryTypes: ['fact'],
            provider: mockProvider,
            modelParams: { model: 'gpt-4', temperature: 0, maxTokens: 100 },
        };

        // Simulate successful Maker extraction
        (makerReliableExtractMemory as any).mockResolvedValue({
            summary: 'Discussion about API.',
            decisions: ['Use GraphQL'],
            todos: []
        });

        await strategy.extract(mockConversation, 'workspace-1', config);

        // Verify makerReliableExtractMemory was called with formatted text
        expect(makerReliableExtractMemory).toHaveBeenCalledWith(
            expect.stringContaining('USER: What should we do about the API?\n\nASSISTANT: We should use GraphQL.'),
            expect.anything()
        );
    });

    it('should map Maker results to standard memories', async () => {
        const mockProvider = {
            complete: vi.fn(),
            completeStructured: vi.fn(),
            completeWithFunctions: vi.fn(),
            name: 'mock',
        };
        const config = {
            memoryTypes: ['fact'],
            provider: mockProvider,
            modelParams: { model: 'gpt-4', temperature: 0, maxTokens: 100 },
        };

        (makerReliableExtractMemory as any).mockResolvedValue({
            summary: 'My Summary',
            decisions: ['Decision 1'],
            todos: ['Todo 1']
        });

        const result = await strategy.extract(mockConversation, 'workspace-1', config);

        expect(result.memories).toHaveLength(3);

        const summary = result.memories.find(m => m.metadata?.category === 'summary');
        expect(summary).toBeDefined();
        expect(summary?.content).toBe('Session Summary: My Summary');

        const decision = result.memories.find(m => m.type === 'decision');
        expect(decision).toBeDefined();
        expect(decision?.content).toBe('Decision 1');

        const todo = result.memories.find(m => m.content?.includes('TODO:'));
        expect(todo).toBeDefined();
        expect(todo?.content).toBe('TODO: Todo 1');
    });
});
