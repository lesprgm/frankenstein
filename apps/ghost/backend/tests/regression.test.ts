import { describe, it, expect } from 'vitest';
import { llmCoordinator } from '../src/services/llm-coordinator';
import type { MemoryReference } from '../src/types';

describe('Ghost Regression Tests - Demo Flows', () => {

    // Helper to create memories
    const createMemory = (id: string, summary: string, path?: string, type: string = 'entity.file'): MemoryReference => ({
        id,
        type,
        score: 1,
        summary,
        metadata: path ? { path, name: path.split('/').pop() } : {},
    });

    it('Flow 1: "Open the latest PDF in Downloads"', async () => {
        const memories = [
            createMemory('1', 'old_report.pdf', '/Users/demo/Downloads/old_report.pdf'),
            createMemory('2', 'new_report.pdf', '/Users/demo/Downloads/new_report.pdf'),
        ];
        // Mock modified dates in metadata
        memories[0].metadata!.modified = new Date('2023-01-01').toISOString();
        memories[1].metadata!.modified = new Date('2023-12-01').toISOString();

        const response = await llmCoordinator.generateResponse('Open the latest PDF in Downloads', '', memories);

        // Should open the newer file
        expect(response.actions).toHaveLength(1);
        expect(response.actions[0].type).toBe('file.open');
        expect((response.actions[0].params as any).path).toContain('new_report.pdf');
    });

    it('Flow 2: "Scroll to the chart section"', async () => {
        const response = await llmCoordinator.generateResponse('Scroll down to the chart', '', []);

        expect(response.actions).toHaveLength(1);
        expect(response.actions[0].type).toBe('file.scroll');
        expect((response.actions[0].params as any).direction).toBe('down');
    });

    it('Flow 3: "What do we know about Project X?" (Entity Recall)', async () => {
        const memories = [
            createMemory('1', 'Project X is a top secret initiative', undefined, 'entity.project'),
        ];

        const response = await llmCoordinator.generateResponse('What do we know about Project X?', '', memories);

        expect(response.actions).toHaveLength(1);
        // Summarization and recall are both acceptable; prefer summarize when available
        expect(['info.recall', 'info.summarize']).toContain(response.actions[0].type);
        const summary = (response.actions[0].params as any).summary || (response.actions[0].params as any).topic;
        expect(summary).toContain('Project X');
    });

    it('Flow 4: "Open file from yesterday"', async () => {
        const memories = [
            createMemory('1', 'notes.txt', '/Users/demo/Documents/notes.txt'),
        ];

        const response = await llmCoordinator.generateResponse('Open the file from yesterday', '', memories);

        expect(response.actions).toHaveLength(1);
        expect(response.actions[0].type).toBe('file.open');
        expect((response.actions[0].params as any).path).toBe('/Users/demo/Documents/notes.txt');
    });
});
