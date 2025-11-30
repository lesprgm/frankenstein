/**
 * Gemini LLM Provider Adapter for MAKER
 * 
 * Adapts the Ghost backend's Gemini integration to work with MAKER's
 * MakerLLMProvider interface.
 */

import { llmCoordinator } from './llm-coordinator.js';
import type { MakerLLMProvider } from '@memorylayer/memory-extraction';

/**
 * Gemini provider adapter for MAKER microagents
 * 
 * Bridges the MAKER interface with Ghost's existing Gemini integration
 */
export class GeminiMakerProvider implements MakerLLMProvider {
    /**
     * Call Gemini Flash with the given prompt
     * 
     * @param prompt - The prompt to send to Gemini
     * @param options - Optional temperature and timeout settings
     * @returns The text response from Gemini
     */
    async call(
        prompt: string,
        options?: { temperature?: number; timeout?: number }
    ): Promise<string> {
        return llmCoordinator.callGeminiFlash({
            prompt,
            temperature: options?.temperature,
            timeout: options?.timeout,
        });
    }
}

/**
 * Singleton instance for use across the backend
 */
export const geminiMakerProvider = new GeminiMakerProvider();
