import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../src/services/context-builder';
import { MemoryLayerIntegration } from '../src/services/memory-layer-integration';

describe('ContextBuilder', () => {
    let contextBuilder: ContextBuilder;
    let mockMemoryLayer: any;
    let mockContextEngine: any;

    beforeEach(() => {
        mockContextEngine = {
            buildContext: vi.fn()
        };

        mockMemoryLayer = {
            isInitialized: vi.fn().mockReturnValue(true),
            initialize: vi.fn().mockResolvedValue(undefined),
            contextEngine: mockContextEngine
        };

        contextBuilder = new ContextBuilder(mockMemoryLayer);
    });

    it('should boost score of fact-type memories by 1.5x', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact', summary: 'Content memory', metadata: {} },
                score: 0.8
            },
            {
                memory: { id: '2', type: 'entity.file', summary: 'File metadata', metadata: {} },
                score: 0.5
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('test query', 'user-1');

        expect(result.memories).toHaveLength(2);

        // Fact memory should be boosted: 0.8 * 1.5 = 1.2
        const factMem = result.memories.find(m => m.memory.type === 'fact');
        expect(factMem?.score).toBeCloseTo(1.2);

        // Entity memory should stay same: 0.5
        const fileMem = result.memories.find(m => m.memory.type === 'entity.file');
        expect(fileMem?.score).toBe(0.5);
    });

    it('should filter out conversational memories (fact.command, fact.response)', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact', summary: 'Content', metadata: {} },
                score: 0.9
            },
            {
                memory: { id: '2', type: 'fact.command', summary: 'User query', metadata: {} },
                score: 0.95
            },
            {
                memory: { id: '3', type: 'fact.response', summary: 'AI response', metadata: {} },
                score: 0.95
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('test query', 'user-1');

        expect(result.memories).toHaveLength(1);
        expect(result.memories[0].memory.type).toBe('fact');
    });

    it('should filter out fact.session memories (self-referential query logs)', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact', summary: 'Sarah proposed GraphQL for API redesign', metadata: {} },
                score: 0.8
            },
            {
                memory: { id: '2', type: 'fact.session', summary: 'The user was inquiring about API redesign with Sarah', metadata: {} },
                score: 0.95
            },
            {
                memory: { id: '3', type: 'fact.session', summary: 'The assistant responded with information about Sarah', metadata: {} },
                score: 0.9
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('What did Sarah say about API redesign?', 'user-1');

        // Only the actual fact should remain, not the session logs
        expect(result.memories).toHaveLength(1);
        expect(result.memories[0].memory.type).toBe('fact');
        expect(result.memories[0].memory.summary).toContain('Sarah proposed GraphQL');
    });

    it('should filter out meta-commentary patterns in memory summaries', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact', summary: 'Meeting notes: Sarah proposed moving to GraphQL', metadata: {} },
                score: 0.7
            },
            {
                memory: { id: '2', type: 'fact', summary: 'The user was inquiring about details regarding an API redesign', metadata: {} },
                score: 0.9
            },
            {
                memory: { id: '3', type: 'entity', summary: 'The assistant responded by providing information', metadata: {} },
                score: 0.85
            },
            {
                memory: { id: '4', type: 'fact', summary: 'In response to the query, the system found documents', metadata: {} },
                score: 0.8
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('test query', 'user-1');

        // Only the actual meeting notes should remain
        expect(result.memories).toHaveLength(1);
        expect(result.memories[0].memory.id).toBe('1');
        expect(result.memories[0].memory.summary).toContain('Meeting notes');
    });

    it('should re-sort memories after boosting', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'entity.file', summary: 'File metadata', metadata: {} },
                score: 0.8 // High score initially
            },
            {
                memory: { id: '2', type: 'fact', summary: 'Content', metadata: {} },
                score: 0.6 // Lower score initially
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('test query', 'user-1');

        // Fact memory boosted: 0.6 * 1.5 = 0.9
        // File memory: 0.8
        // Fact (0.9) should now be first
        expect(result.memories[0].memory.type).toBe('fact');
        expect(result.memories[0].score).toBeCloseTo(0.9);

        expect(result.memories[1].memory.type).toBe('entity.file');
        expect(result.memories[1].score).toBe(0.8);
    });

    it('should return fallback context when ContextEngine is unavailable', async () => {
        const builderWithoutEngine = new ContextBuilder({
            isInitialized: vi.fn().mockReturnValue(true),
            initialize: vi.fn().mockResolvedValue(undefined),
            contextEngine: null
        } as any);

        const result = await builderWithoutEngine.buildContext('test query', 'user-1');

        expect(result.memories).toHaveLength(0);
        expect(result.context).toContain('No context memories available');
    });

    it('should handle mixed memory types and prioritize actual content', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact.session', summary: 'The user inquired about the meeting', metadata: {} },
                score: 0.95
            },
            {
                memory: { id: '2', type: 'entity.person', summary: 'Sarah - Lead Developer at Acme Corp', metadata: {} },
                score: 0.7
            },
            {
                memory: { id: '3', type: 'fact', summary: 'API redesign meeting scheduled for Tuesday', metadata: {} },
                score: 0.65
            },
            {
                memory: { id: '4', type: 'context.screen', summary: 'User was viewing VS Code', metadata: {} },
                score: 0.6
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('tell me about the meeting', 'user-1');

        // fact.session should be filtered, context.screen should be filtered if we have other content
        // Only entity.person and fact should remain
        expect(result.memories.length).toBeGreaterThanOrEqual(2);
        
        const types = result.memories.map(m => m.memory.type);
        expect(types).not.toContain('fact.session');
        expect(types).toContain('entity.person');
        expect(types).toContain('fact');
    });

    it('should boost doc.chunk memories by 1.5x like fact memories', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'doc.chunk', summary: 'Meeting notes: Sarah expressed support for GraphQL', metadata: {} },
                score: 0.7
            },
            {
                memory: { id: '2', type: 'entity.file', summary: 'API_Meeting_Notes.txt @ /path', metadata: {} },
                score: 0.8
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('What did Sarah say?', 'user-1');

        // doc.chunk should be boosted: 0.7 * 1.5 = 1.05
        // entity.file stays at 0.8
        // So doc.chunk should be first after sorting
        expect(result.memories).toHaveLength(2);
        expect(result.memories[0].memory.type).toBe('doc.chunk');
        expect(result.memories[0].score).toBeCloseTo(1.05);
    });

    it('should filter meta-commentary patterns including "the user was asking"', async () => {
        const mockMemories = [
            {
                memory: { id: '1', type: 'fact.session', summary: 'The user was asking for information about Sarah', metadata: {} },
                score: 0.9
            },
            {
                memory: { id: '2', type: 'fact.session', summary: 'The assistant provided Sarah\'s email address, presumably to facilitate further communication', metadata: {} },
                score: 0.85
            },
            {
                memory: { id: '3', type: 'doc.chunk', summary: 'Meeting notes: Sarah proposed moving to GraphQL', metadata: {} },
                score: 0.7
            }
        ];

        mockContextEngine.buildContext.mockResolvedValue({
            ok: true,
            value: {
                context: 'Built context',
                memories: mockMemories
            }
        });

        const result = await contextBuilder.buildContext('What did Sarah say?', 'user-1');

        // Both fact.session memories should be filtered due to meta-commentary patterns
        expect(result.memories).toHaveLength(1);
        expect(result.memories[0].memory.type).toBe('doc.chunk');
        expect(result.memories[0].memory.summary).toContain('Sarah proposed');
    });
});
