/**
 * Dashboard API routes
 */

import { Hono } from 'hono';
import { storageService } from '../services/storage.js';

const dashboard = new Hono();
const DEFAULT_LIMIT = 50;

/**
 * GET /api/dashboard/commands
 * Get recent commands with memories and actions
 */
dashboard.get('/commands', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || `${DEFAULT_LIMIT}`, 10);

    const data = storageService.getDashboardData(limit);
    return c.json(data);
  } catch (error) {
    console.error('Dashboard commands error:', error);
    return c.json({
      error: 'Failed to fetch commands',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /api/dashboard/stats
 * Get dashboard statistics
 */
dashboard.get('/stats', async (c) => {
  try {
    const stats = storageService.getStats();
    return c.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return c.json({
      error: 'Failed to fetch stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /api/dashboard/stream-latest
 * Streams the latest command's assistant_text as tokens, then emits a final event with the full payload.
 * This is meant for the dashboard to visualize “live” streaming even after a command is completed.
 */
dashboard.get('/stream-latest', async (c) => {
  try {
    const data = storageService.getDashboardData(1);
    const latest = data.commands[0];
    if (!latest) {
      return c.stream(async (stream) => {
        await stream.write(`event: error\ndata:${JSON.stringify({ message: 'No commands yet' })}\n\n`);
      }, sseHeaders());
    }

    const tokens = chunkText(latest.assistant_text || '', 8);

    return c.stream(async (stream) => {
      for (const t of tokens) {
        await stream.write(`event: token\ndata:${JSON.stringify({ text: t })}\n\n`);
      }
      await stream.write(`event: final\ndata:${JSON.stringify({ command: latest })}\n\n`);
    }, sseHeaders());
  } catch (error) {
    console.error('Dashboard stream error:', error);
    return c.stream(async (stream) => {
      await stream.write(`event: error\ndata:${JSON.stringify({ message: 'Stream failed' })}\n\n`);
    }, sseHeaders());
  }
});

function sseHeaders() {
  return {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  };
}

function chunkText(text: string, wordsPerChunk: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  return chunks;
}

/**
 * GET /api/commands/:id
 * Fetch a specific command by ID with full memory graph
 */
dashboard.get('/commands/:id', async (c) => {
  const commandId = c.req.param('id');

  if (!commandId) {
    return c.json({ error: 'Command ID required' }, 400);
  }

  const storage = storageService.getHealth();
  if (!storage.ok) {
    return c.json({ error: 'Storage unavailable' }, 503);
  }

  try {
    const { db } = storage.value;

    // Fetch the command with all its details
    // Fetch the command basic info
    const command = db.prepare(`
      SELECT 
        id,
        text,
        assistant_text,
        timestamp as created_at
      FROM commands
      WHERE id = ?
      LIMIT 1
    `).get(commandId) as {
      id: string;
      text: string;
      assistant_text: string;
      created_at: string;
    } | undefined;

    if (!command) {
      return c.json({ error: 'Command not found' }, 404);
    }

    // Fetch actions
    const actions = db.prepare(`
      SELECT type, params, status, executed_at
      FROM actions
      WHERE command_id = ?
    `).all(commandId).map((a: any) => ({
      action: {
        type: a.type,
        params: JSON.parse(a.params)
      },
      status: a.status,
      executedAt: a.executed_at
    }));

    // Fetch memories used
    const memories = db.prepare(`
      SELECT 
        m.id,
        m.type,
        m.content as summary,
        m.confidence as score,
        m.metadata
      FROM command_memories cm
      JOIN memories m ON cm.memory_id = m.id
      WHERE cm.command_id = ?
    `).all(commandId).map((m: any) => ({
      id: m.id,
      type: m.type,
      score: m.score,
      summary: m.summary,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined
    }));

    return c.json({
      ...command,
      actions,
      memories_used: memories
    });
  } catch (err) {
    console.error('Failed to fetch command:', err);
    return c.json({ error: 'Failed to fetch command' }, 500);
  }
});

export default dashboard;
