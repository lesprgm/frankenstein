/**
 * MAKER Reliable Memory Extractor
 * 
 * Implements the MAKER framework for reliable memory extraction:
 * - Microagents: Multiple parallel LLM calls
 * - K-threshold voting: Consensus-based error correction
 * - Red-flagging: Schema validation to filter malformed outputs
 */

import { makerConfig } from './maker-config.js';
import { buildExtractionPrompt } from './maker-prompts.js';

/**
 * Schema for extracted session memories
 */
export interface ExtractedMemory {
    summary: string;         // 3-5 sentence natural language summary
    decisions: string[];     // Decision bullets ("We decided to...")
    todos: string[];         // Action items ("Implement...", "Refactor...")
}

/**
 * LLM provider interface for MAKER microagents
 */
export interface MakerLLMProvider {
    /**
     * Call the LLM with a prompt
     * @param prompt - The prompt to send
     * @param options - Temperature and timeout options
     * @returns The LLM's text response
     */
    call(prompt: string, options?: { temperature?: number; timeout?: number }): Promise<string>;
}

/**
 * Step 1: Run N parallel microagent calls (MAKER's maximal decomposition)
 * 
 * @param sourceText - Text to extract memories from
 * @param llmProvider - LLM provider for making API calls
 * @returns Array of raw string outputs from successful microagents
 */
async function runExtractionMicroagents(
    sourceText: string,
    llmProvider: MakerLLMProvider
): Promise<string[]> {
    const prompt = buildExtractionPrompt(sourceText);
    const calls: Promise<string>[] = [];

    console.log(`[MAKER] Launching ${makerConfig.replicas} microagents...`);

    for (let i = 0; i < makerConfig.replicas; i++) {
        calls.push(
            llmProvider
                .call(prompt, {
                    temperature: makerConfig.temperature,
                    timeout: makerConfig.timeout,
                })
                .catch((error) => {
                    console.warn(`[MAKER] Microagent ${i + 1} failed:`, error.message);
                    return ''; // Return empty string on failure
                })
        );
    }

    // Run in parallel – keeps latency ≈ single call
    const outputs = await Promise.all(calls);

    // Filter out failed calls (empty strings)
    return outputs.filter((output) => output.trim().length > 0);
}

/**
 * Step 2: Red-flagging validation (MAKER's error filtering)
 * 
 * Validates schema and rejects obviously malformed or hallucinated outputs.
 * 
 * @param raw - Raw JSON string from microagent
 * @returns Parsed and validated ExtractedMemory, or null if invalid
 */
function tryParseAndValidate(raw: string): ExtractedMemory | null {
    try {
        // Strip markdown code fences if present
        let cleaned = raw.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        }

        const obj = JSON.parse(cleaned);

        // Type checks
        if (typeof obj.summary !== 'string') {
            console.warn('[MAKER] Red-flag: summary is not a string');
            return null;
        }
        if (!Array.isArray(obj.decisions)) {
            console.warn('[MAKER] Red-flag: decisions is not an array');
            return null;
        }
        if (!Array.isArray(obj.todos)) {
            console.warn('[MAKER] Red-flag: todos is not an array');
            return null;
        }

        // Content checks
        if (obj.summary.length < 20) {
            console.warn('[MAKER] Red-flag: summary too short (<20 chars)');
            return null;
        }
        if (obj.summary.length > 1500) {
            console.warn('[MAKER] Red-flag: summary too long (>1500 chars)');
            return null;
        }

        // Must have at least some content
        if (obj.decisions.length === 0 && obj.todos.length === 0 && obj.summary.length < 50) {
            console.warn('[MAKER] Red-flag: insufficient content');
            return null;
        }

        // Validate array contents are strings
        if (obj.decisions.some((d: any) => typeof d !== 'string')) {
            console.warn('[MAKER] Red-flag: decisions contains non-string');
            return null;
        }
        if (obj.todos.some((t: any) => typeof t !== 'string')) {
            console.warn('[MAKER] Red-flag: todos contains non-string');
            return null;
        }

        return obj as ExtractedMemory;
    } catch (error) {
        console.warn('[MAKER] Red-flag: JSON parse failed:', error instanceof Error ? error.message : 'unknown');
        return null;
    }
}

/**
 * Step 3: K-threshold voting (MAKER's consensus-based error correction)
 * 
 * Selects the candidate with most overlap with other candidates.
 * This is a simple voting scheme - production could use embedding similarity.
 * 
 * @param candidates - Array of validated ExtractedMemory candidates
 * @returns Consensus memory, or null if no candidates
 */
function voteOnMemories(candidates: ExtractedMemory[]): ExtractedMemory | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    console.log(`[MAKER] Voting on ${candidates.length} valid candidates...`);

    // Naive voting: pick candidate with most overlapping decisions/todos
    let best = candidates[0];
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
        let score = 0;

        for (let j = 0; j < candidates.length; j++) {
            if (i === j) continue;

            // Count exact matches in decisions
            const overlapDecisions = candidates[i].decisions.filter((d) =>
                candidates[j].decisions.includes(d)
            ).length;

            // Count exact matches in todos
            const overlapTodos = candidates[i].todos.filter((t) => candidates[j].todos.includes(t)).length;

            score += overlapDecisions + overlapTodos;
        }

        if (score > bestScore) {
            bestScore = score;
            best = candidates[i];
        }
    }

    console.log(`[MAKER] Selected consensus with overlap score: ${bestScore}`);
    return best;
}

/**
 * Main MAKER extraction function
 * 
 * Orchestrates microagents, validation, and voting to produce a reliable memory.
 * 
 * @param sourceText - Text to extract memories from
 * @param llmProvider - LLM provider for making API calls
 * @returns Extracted memory or null if extraction failed
 */
export async function makerReliableExtractMemory(
    sourceText: string,
    llmProvider: MakerLLMProvider
): Promise<ExtractedMemory | null> {
    if (!makerConfig.enabled) {
        console.log('[MAKER] Reliability layer disabled, skipping extraction');
        return null;
    }

    console.log('[MAKER] Starting reliable memory extraction...');

    // Step 1: Run microagents in parallel
    const rawOutputs = await runExtractionMicroagents(sourceText, llmProvider);
    console.log(`[MAKER] Got ${rawOutputs.length}/${makerConfig.replicas} successful microagent outputs`);

    if (rawOutputs.length === 0) {
        console.warn('[MAKER] All microagents failed - no outputs to validate');
        return null;
    }

    // Step 2: Red-flagging - validate each output
    const valid = rawOutputs.map(tryParseAndValidate).filter((m): m is ExtractedMemory => m !== null);

    console.log(`[MAKER] ${valid.length}/${rawOutputs.length} outputs passed validation`);

    if (valid.length === 0) {
        console.warn('[MAKER] All outputs failed validation - red-flagged');
        return null;
    }

    // Step 3: Voting - select consensus
    const result = voteOnMemories(valid);

    if (result) {
        console.log('[MAKER] ✓ Successfully extracted consensus memory');
    } else {
        console.warn('[MAKER] Voting failed to select a result');
    }

    return result;
}
