import { Hono } from 'hono';
import { storageService } from '../services/storage.js';

const search = new Hono();

/**
 * GET /api/search
 * Semantic search over memories
 */
search.get('/', async (c) => {
    const query = c.req.query('q');
    const userId = c.req.query('userId') || 'ghost'; // Default to ghost user for now
    const limit = parseInt(c.req.query('limit') || '10', 10);

    if (!query) {
        return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    try {
        const result = await storageService.searchMemories(query, userId, limit);
        if (!result.ok) {
            return c.json({ error: result.error.message }, 500);
        }

        return c.json({
            query,
            results: result.value
        });
    } catch (error) {
        console.error('Search error:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

export default search;
