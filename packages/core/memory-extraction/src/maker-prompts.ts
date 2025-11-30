/**
 * MAKER Microagent Extraction Prompts
 * 
 * Focused, minimal prompts for memory extraction microagents.
 * Each microagent receives the same prompt to ensure consistency in task decomposition.
 */

/**
 * Build extraction prompt for a microagent.
 * 
 * This prompt is intentionally minimal and focused, following MAKER's principle
 * of maximal agentic decomposition - each microagent handles one atomic subtask.
 * 
 * @param sourceText - The text to extract memories from (conversation, notes, etc.)
 * @returns Prompt string for the microagent
 */
export function buildExtractionPrompt(sourceText: string): string {
    return `You are a memory extraction microagent for an AI assistant.

Your task is to extract a clean, structured memory object from the following text.
The text may contain a mixture of code, notes, and previous assistant output.

Return STRICT JSON with this shape:
{
  "summary": "3-5 sentence natural language summary of what the user was working on.",
  "decisions": ["bullet point decision 1", "bullet point decision 2", ...],
  "todos": ["bullet point TODO 1", "bullet point TODO 2", ...]
}

Rules:
- Use only information present in the text.
- Do NOT hallucinate filenames, APIs, or tools that are not mentioned.
- "decisions" must start with a verb ("We decided to...", "Chose to...", "Agreed to...").
- "todos" must be concrete future actions ("Implement...", "Refactor...", "Write tests for...", "Fix...").
- If no clear decisions or todos are present, use empty arrays.
- Keep summary concise but informative.

TEXT:
---
${sourceText}
---

Respond with JSON only, no markdown code fences.`;
}
