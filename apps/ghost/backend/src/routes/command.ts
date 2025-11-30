/**
 * Command processing routes
 */

import { Hono } from 'hono';
import type { CommandRequest } from '../types.js';
import { commandProcessor } from '../services/command-processor.js';

const command = new Hono();

/**
 * POST /api/command
 * Process a voice command from the daemon
 */
command.post('/', async (c) => {
  try {
    const body = (await c.req.json()) as CommandRequest;

    const result = await commandProcessor.process(body);
    if (!result.ok) {
      if (result.error.type === 'validation_error') {
        return c.json({ error: result.error.message }, 400);
      }
      return c.json({ error: result.error.message }, 500);
    }

    return c.json(result.value);
  } catch (error) {
    console.error('Command processing error:', error);
    return c.json({
      error: 'Failed to process command',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/command/stream
 * SSE stream: emits token events as assistant_text is produced, then a final event with full payload.
 * This is a thin wrapper over the existing processor; it simply chunks the final assistant_text
 * to reduce perceived latency for the client.
 */
command.post('/stream', async (c) => {
  try {
    const body = (await c.req.json()) as CommandRequest;
    const result = await commandProcessor.process(body);
    if (!result.ok) {
      const status = result.error.type === 'validation_error' ? 400 : 500;
      return c.json({ error: result.error.message }, status);
    }

    const response = result.value;
    const recallAction = response.actions.find((a) => a.type === 'info.recall');
    const recallSummary =
      recallAction && typeof (recallAction.params as any)?.summary === 'string'
        ? (recallAction.params as any).summary as string
        : undefined;
    const safeAssistantText = recallSummary?.trim().length ? recallSummary : response.assistant_text;
    const tokens = chunkText(safeAssistantText, 10);

    return c.stream(async (stream) => {
      // Stream tokens
      for (const t of tokens) {
        await stream.write(`event: token\ndata:${JSON.stringify({ text: t })}\n\n`);
      }
      // Final envelope
      await stream.write(`event: final\ndata:${JSON.stringify(response)}\n\n`);
    }, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Streaming command processing error:', error);
    return c.stream(async (stream) => {
      await stream.write(`event: error\ndata:${JSON.stringify({ message: 'Failed to process command' })}\n\n`);
    }, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }
});

function chunkText(text: string, wordsPerChunk: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  return chunks;
}

export default command;
