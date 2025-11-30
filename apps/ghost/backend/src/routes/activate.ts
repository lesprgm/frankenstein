import { Hono } from 'hono';

const app = new Hono();

/**
 * POST /api/activate
 * Trigger Ghost voice activation (simulates hotkey press)
 */
app.post('/', async (c) => {
    try {
        // Since the daemon is a separate process, this endpoint would need to communicate
        // with the daemon via IPC or HTTP. For now, we'll return success.
        // The dashboard button can also directly trigger the global hotkey via the daemon.

        return c.json({
            success: true,
            message: 'Activation signal sent',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Activation error:', error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

export default app;
