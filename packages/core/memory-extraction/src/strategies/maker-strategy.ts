
import {
    ExtractionStrategy,
    NormalizedConversation,
    NormalizedMessage,
    StrategyConfig,
    RawExtractionResult,
    IncrementalContext,
    ExtractedMemory,
    ExtractedRelationship,
} from '../types.js';
import { makerReliableExtractMemory, MakerLLMProvider } from '../maker-extractor.js';

export class MakerStrategy implements ExtractionStrategy {
    readonly name = 'maker-reliable';

    async extract(
        conversation: NormalizedConversation,
        workspaceId: string,
        config: StrategyConfig
    ): Promise<RawExtractionResult> {

        // 1. Adapter: Convert NormalizedConversation to plain text source
        const sourceText = conversation.messages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n');

        // 2. Adapter: Wrap the standard LLMProvider to match MakerLLMProvider interface
        // Maker expects .call(prompt, options) -> string
        const makerProvider: MakerLLMProvider = {
            call: async (prompt, options) => {
                return config.provider.complete(prompt, {
                    model: config.modelParams.model,
                    maxTokens: 4000,
                    temperature: options?.temperature ?? config.modelParams.temperature,
                });
            }
        };

        // 3. Execute MAKER reliable extraction
        const result = await makerReliableExtractMemory(sourceText, makerProvider);

        if (!result) {
            // Fallback or empty result if Maker failed/disabled
            return { memories: [], relationships: [] };
        }

        // 4. Transform Maker schema (summary, decisions, todos) to System schema (memories)
        const memories: Partial<ExtractedMemory>[] = [];

        // Map summary -> 'fact' type
        if (result.summary) {
            memories.push({
                type: 'fact',
                content: `Session Summary: ${result.summary}`,
                confidence: 1.0, // High confidence due to consensus
                metadata: { category: 'summary' }
            });
        }

        // Map decisions -> 'decision' type
        result.decisions.forEach(decision => {
            memories.push({
                type: 'decision',
                content: decision,
                confidence: 0.9,
                metadata: { source: 'maker-consensus' }
            });
        });

        // Map todos -> 'task'/'todo' type (using 'fact' if 'task' not configured, but we'll use 'fact' with category='todo' for safety or 'decision')
        // Let's use 'fact' with metadata for now to stick to standard types
        result.todos.forEach(todo => {
            memories.push({
                type: 'fact',
                content: `TODO: ${todo}`,
                confidence: 0.9,
                metadata: { category: 'action_item', source: 'maker-consensus' }
            });
        });

        return {
            memories,
            relationships: [] // Maker v1 doesn't extract relationships
        };
    }

    // Maker strategy doesn't support incremental extraction yet - fallback to full extract or throw
    async extractIncremental(
        messages: NormalizedMessage[],
        context: IncrementalContext
    ): Promise<RawExtractionResult> {
        throw new Error("MakerStrategy does not support incremental extraction");
    }
}
