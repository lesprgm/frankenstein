import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQLiteStorage } from '../src/services/sqlite-storage';

// Use a temp DB per test file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-embeds-'));
const dbPath = path.join(tmpDir, 'ghost.db');

// Mock worker embedding provider to return deterministic vectors and avoid spawning threads
vi.mock('../src/adapters/worker-embedding-provider.js', () => ({
  workerEmbeddingProvider: {
    embed: vi.fn(async (text: string) => Array(5).fill(text.length)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => Array(5).fill(t.length))),
    terminate: vi.fn(),
  },
}));

describe('SQLiteStorage embeddings & relationships', () => {
  let storage: SQLiteStorage;
  const userId = 'test-user';

  beforeAll(() => {
    storage = new SQLiteStorage(dbPath);
  });

  it('indexes files and writes embeddings and collection relationship', async () => {
    const indexResult = await storage.indexFiles({
      user_id: userId,
      files: [
        {
          path: '/tmp/foo.txt',
          name: 'foo.txt',
          modified: new Date().toISOString(),
          size: 123,
        },
      ],
    });

    expect(indexResult.ok).toBe(true);
    if (!indexResult.ok) return;

    // embedding should be present in memories table
    const row = storage['db']
      .prepare('SELECT embedding FROM memories WHERE id = ?')
      .get(indexResult.value.memories[0].id) as { embedding: string | null };
    expect(row.embedding).toBeDefined();
    expect(row.embedding).not.toBeNull();

    // relationship from collection to file should exist
    const rel = storage['db']
      .prepare(
        "SELECT 1 FROM relationships WHERE from_memory_id = ? AND to_memory_id = ? AND relationship_type = 'contains'"
      )
      .get(`collection-files-${userId}`, indexResult.value.memories[0].id) as { 1?: number } | undefined;
    expect(rel).toBeDefined();
  });

  it('skips relationship insert cleanly when target memory is missing', async () => {
    // Force an insertRelationship with a missing target; it should catch and warn, not throw
    expect(() => storage['insertRelationship']('collection-files-test', 'missing-id', 'contains', 0.5)).not.toThrow();
  });
});
