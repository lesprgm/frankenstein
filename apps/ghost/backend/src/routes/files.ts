/**
 * File indexing routes
 */

import { Hono } from 'hono';
import type { FileIndexRequest } from '../types.js';
import { fileIndexer } from '../services/file-indexer.js';

const files = new Hono();

/**
 * POST /api/files/index
 * Index files for memory creation
 */
files.post('/index', async (c) => {
  try {
    const body = (await c.req.json()) as FileIndexRequest;

    const result = await fileIndexer.indexFiles(body);
    if (!result.ok) {
      if (result.error.type === 'validation_error') {
        return c.json({ error: result.error.message }, 400);
      }
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({
      success: true,
      indexed: result.value.indexed,
      memories: result.value.memories,
    });
  } catch (error) {
    console.error('File indexing error:', error);
    return c.json({
      error: 'Failed to index files',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default files;
