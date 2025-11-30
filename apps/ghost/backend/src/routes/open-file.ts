import { Hono } from 'hono';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = new Hono();

/**
 * POST /
 * Opens a file using the system's default application
 */
app.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const { filePath } = body;

        if (!filePath || typeof filePath !== 'string') {
            return c.json({ error: 'filePath is required and must be a string' }, 400);
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return c.json({ error: `File not found: ${filePath}` }, 404);
        }

        // Open file using platform-specific command
        const platform = process.platform;
        let command: string;

        if (platform === 'darwin') {
            // macOS
            command = `open "${filePath}"`;
        } else if (platform === 'win32') {
            // Windows
            command = `start "" "${filePath}"`;
        } else {
            // Linux
            command = `xdg-open "${filePath}"`;
        }

        // Execute the command
        await execAsync(command);

        return c.json({ success: true, filePath });
    } catch (error) {
        console.error('[Ghost][OpenFile] Error:', error);
        return c.json({
            error: error instanceof Error ? error.message : 'Failed to open file'
        }, 500);
    }
});

export default app;
