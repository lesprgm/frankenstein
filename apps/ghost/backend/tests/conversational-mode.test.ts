import { describe, it, expect } from 'vitest';
import { LLMCoordinator } from '../src/services/llm-coordinator.js';
import type { MemoryReference } from '../src/types.js';

describe('LLMCoordinator conversational mode', () => {
    const llm = new LLMCoordinator();

    describe('buildGeminiPayload prompt switching', () => {
        // Access the private method via any cast for testing
        const buildPayload = (text: string, memories: MemoryReference[], conversationalMode?: boolean) =>
            (llm as any).buildGeminiPayload(text, '', memories, undefined, conversationalMode);

        it('should use action mode prompt by default (no conversationalMode)', () => {
            const payload = buildPayload('open the file', []);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('You do not chat; you act');
            expect(promptText).not.toContain('warm and slightly witty');
        });

        it('should use action mode prompt when conversationalMode is false', () => {
            const payload = buildPayload('open the file', [], false);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('You do not chat; you act');
            expect(promptText).not.toContain('warm and slightly witty');
        });

        it('should use chat personality prompt when conversationalMode is true', () => {
            const payload = buildPayload('hey, what did I work on yesterday?', [], true);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('warm and slightly witty');
            expect(promptText).toContain('Hmm...');
            expect(promptText).toContain('Oh!');
            expect(promptText).toContain('follow-up questions');
            expect(promptText).not.toContain('You do not chat; you act');
        });

        it('chat mode should include personality instructions', () => {
            const payload = buildPayload('what are you working on?', [], true);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('PERSONALITY');
            expect(promptText).toContain('natural filler sounds');
            expect(promptText).toContain('empathy');
            expect(promptText).toContain('light humor');
        });

        it('chat mode should still include standard response format', () => {
            const payload = buildPayload('tell me about the project', [], true);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('RESPONSE FORMAT');
            expect(promptText).toContain('assistant_text');
            expect(promptText).toContain('actions');
        });

        it('chat mode should include summary instructions', () => {
            const payload = buildPayload('summarize the notes', [], true);
            const promptText = payload.contents[0].parts[0].text;

            expect(promptText).toContain('CRITICAL INSTRUCTION FOR SUMMARIES');
            expect(promptText).toContain('YOU must write the summary in "assistant_text"');
            expect(promptText).toContain('Do NOT use robotic prefixes');
            expect(promptText).toContain('IGNORE "fact" memories');
        });
    });

    describe('generateResponse with conversationalMode', () => {
        it('should accept conversationalMode parameter without error', async () => {
            const memories: MemoryReference[] = [
                {
                    id: 'mem-1',
                    type: 'fact',
                    score: 0.9,
                    summary: 'Working on the authentication module yesterday',
                    metadata: {},
                },
            ];

            // Should not throw - tests that the 5th parameter is accepted
            const response = await llm.generateResponse(
                'What was I working on?',
                '',
                memories,
                undefined,
                true // conversationalMode
            );

            expect(response).toBeDefined();
            expect(response.assistant_text).toBeDefined();
        });

        it('should work in action mode (default)', async () => {
            const memories: MemoryReference[] = [
                {
                    id: 'mem-1',
                    type: 'entity.file',
                    score: 0.9,
                    summary: 'report.pdf',
                    metadata: { path: '/Users/demo/report.pdf' },
                },
            ];

            const response = await llm.generateResponse(
                'Open the report',
                '',
                memories,
                undefined,
                false // action mode
            );

            expect(response).toBeDefined();
            // In action mode with file memory, should suggest opening
            expect(response.actions.length).toBeGreaterThan(0);
        });
    });
});
