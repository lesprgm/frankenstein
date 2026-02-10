import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExplainabilityNotifier } from '../src/services/explainability-notifier';
import type { MemoryReference } from '../src/types';

describe('ExplainabilityNotifier', () => {
    describe('generateSummary', () => {
        it('should return "No local context found" when memories are empty', () => {
            const summary = ExplainabilityNotifier.generateSummary([]);
            expect(summary).toBe('No local context found');
        });

        it('should return "General Knowledge" when top memory score is low (< 0.65)', () => {
            const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: 0.5,
                    summary: 'test',
                    metadata: { source: 'test.txt' }
                }
            ];
            const summary = ExplainabilityNotifier.generateSummary(memories);
            expect(summary).toBe('General Knowledge');
        });

        it('should return "Context: source" when top memory score is high (>= 0.65) and source exists', () => {
            const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: 0.7,
                    summary: 'test',
                    metadata: { source: 'important.txt' }
                }
            ];
            const summary = ExplainabilityNotifier.generateSummary(memories);
            expect(summary).toBe('Context: important.txt');
        });

        it('should return "Context: type" when top memory score is high (>= 0.65) and source is missing', () => {
            const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: 0.8,
                    summary: 'test',
                    metadata: {}
                }
            ];
            const summary = ExplainabilityNotifier.generateSummary(memories);
            expect(summary).toBe('Context: file memories');
        });

        it('should handle missing score (treat as 0)', () => {
             const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: undefined as any,
                    summary: 'test',
                    metadata: { source: 'test.txt' }
                }
            ];
            const summary = ExplainabilityNotifier.generateSummary(memories);
            expect(summary).toBe('General Knowledge');
        });
    });

    describe('showContextNotification', () => {
        let notifier: ExplainabilityNotifier;
        let mockWindowManager: any;

        beforeEach(() => {
            mockWindowManager = {
                showOverlay: vi.fn()
            };
            notifier = new ExplainabilityNotifier('http://test', mockWindowManager, 'key');
        });

        it('should suppress overlay when confidence is low (General Knowledge)', async () => {
            const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: 0.5, // Low score
                    summary: 'test',
                    metadata: { source: 'test.txt' }
                }
            ];

            await notifier.showContextNotification({
                commandId: '123',
                summary: 'test',
                memoryCount: 1,
                memories
            });

            expect(mockWindowManager.showOverlay).not.toHaveBeenCalled();
        });

        it('should show overlay when confidence is high', async () => {
            const memories: MemoryReference[] = [
                {
                    id: '1',
                    type: 'entity.file',
                    score: 0.8, // High score
                    summary: 'test',
                    metadata: { source: 'test.txt' }
                }
            ];

            await notifier.showContextNotification({
                commandId: '123',
                summary: 'test',
                memoryCount: 1,
                memories
            });

            expect(mockWindowManager.showOverlay).toHaveBeenCalled();
        });
    });
});
