import { Hono } from 'hono';
import { storageService } from '../services/storage.js';
import { ExplainabilityService, type ExplanationContext } from '../services/explainability-service.js';

const app = new Hono();

// Initialize service
const explainService = new ExplainabilityService((storageService as any).db);

/**
 * POST /api/explain/store
 * Store explanation context for a command
 */
app.post('/store', async (c) => {
    try {
        const context: ExplanationContext = await c.req.json();

        if (!context.commandId || !context.commandText) {
            return c.json({ error: 'commandId and commandText are required' }, 400);
        }

        await explainService.storeExplanation(context);

        return c.json({ success: true, commandId: context.commandId });
    } catch (error) {
        console.error('[Ghost][Explainability] Store error:', error);
        return c.json(
            { error: error instanceof Error ? error.message : 'Failed to store explanation' },
            500
        );
    }
});

/**
 * GET /api/explain/:commandId
 * Retrieve explanation context for a command
 */
app.get('/:commandId', async (c) => {
    try {
        const commandId = c.req.param('commandId');

        const explanation = await explainService.getExplanation(commandId);

        if (!explanation) {
            return c.json({ error: 'Explanation not found' }, 404);
        }

        return c.json(explanation);
    } catch (error) {
        console.error('[Ghost][Explainability] Retrieve error:', error);
        return c.json(
            { error: error instanceof Error ? error.message : 'Failed to retrieve explanation' },
            500
        );
    }
});

/**
 * DELETE /api/explain/cleanup
 * Clean up old explanations (older than 7 days)
 */
app.delete('/cleanup', async (c) => {
    try {
        const deletedCount = await explainService.cleanupOldExplanations();

        return c.json({ success: true, deletedCount });
    } catch (error) {
        console.error('[Ghost][Explainability] Cleanup error:', error);
        return c.json(
            { error: error instanceof Error ? error.message : 'Cleanup failed' },
            500
        );
    }
});

export default app;
