import { describe, it, expect } from 'vitest';
import { buildExtractionPrompt } from '../maker-prompts';

// Experimental prompt with technical few-shot examples
function buildTechnicalPrompt(sourceText: string): string {
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

EXAMPLES:

Input:
"I think we should use PostgreSQL instead of MongoDB because we need strict schemas. Also, let's bump the timeout to 5000ms."

Output:
{
  "summary": "User discussed database choice and configuration settings.",
  "decisions": ["Use PostgreSQL instead of MongoDB for strict schemas", "Increase timeout to 5000ms"],
  "todos": []
}

Input:
"The API is returning 500 errors. I'll fix the retry logic in api-client.ts tomorrow."

Output:
{
  "summary": "User identified an API error issue.",
  "decisions": [],
  "todos": ["Fix retry logic in api-client.ts"]
}

TEXT:
---
${sourceText}
---

Respond with JSON only, no markdown code fences.`;
}

describe('Prompt Engineering Experiment', () => {
    it('should include technical examples in the new prompt', () => {
        const text = "Let's use Redis for caching.";
        const prompt = buildTechnicalPrompt(text);
        
        expect(prompt).toContain('Use PostgreSQL instead of MongoDB');
        expect(prompt).toContain('Fix retry logic in api-client.ts');
        expect(prompt).toContain(text);
    });

    it('should maintain the same JSON structure requirement', () => {
        const text = "test";
        const oldPrompt = buildExtractionPrompt(text);
        const newPrompt = buildTechnicalPrompt(text);

        // Extract the JSON shape block from both
        const shapeRegex = /Return STRICT JSON with this shape:\s*({[\s\S]*?})/;
        const oldShape = oldPrompt.match(shapeRegex)?.[1];
        const newShape = newPrompt.match(shapeRegex)?.[1];

        // Normalize whitespace for comparison
        const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
        
        expect(normalize(oldShape!)).toBe(normalize(newShape!));
    });
});
