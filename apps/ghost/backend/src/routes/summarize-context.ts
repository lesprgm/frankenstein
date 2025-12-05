/**
 * Context Summarization Route
 * 
 * Provides LLM-based summarization of screen context (OCR text)
 * for use in reminders and recall.
 */

import { Hono } from 'hono';
import { llmCoordinator } from '../services/llm-coordinator.js';

const app = new Hono();

/**
 * POST /api/summarize-context
 * 
 * Summarize OCR text from a screenshot using Gemini Flash.
 * Used when creating reminders to generate an intelligent summary
 * of what the user was looking at.
 * 
 * Request body: { text: string }
 * Response: { summary: string | null }
 */
app.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const { text } = body;

        if (!text || typeof text !== 'string' || text.trim().length < 10) {
            return c.json({ summary: null });
        }

        const summary = await llmCoordinator.summarizeScreenContext(text);
        return c.json({ summary });
    } catch (error) {
        console.error('[summarize-context] Error:', error);
        return c.json({ summary: null });
    }
});

export default app;
