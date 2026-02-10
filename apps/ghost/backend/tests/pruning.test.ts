import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteStorage } from '../src/services/sqlite-storage';
import Database from 'better-sqlite3';

// Mock the worker embedding provider to avoid spawning threads
vi.mock('../src/adapters/worker-embedding-provider.js', () => ({
  workerEmbeddingProvider: {
    terminate: vi.fn(),
  },
}));

describe('Memory Pruning', () => {
  let storage: SQLiteStorage;
  let db: Database.Database;

  beforeEach(() => {
    // Use in-memory database for speed and isolation
    storage = new SQLiteStorage(':memory:');
    // Access the private db instance to insert test data
    db = (storage as any).db;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('should prune old ephemeral memories', async () => {
    // Insert old screen context (8 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('old-screen', 'context.screen', 'old screen', datetime('now', '-8 days'), 'demo')
    `).run();

    // Insert new screen context (1 day ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('new-screen', 'context.screen', 'new screen', datetime('now', '-1 days'), 'demo')
    `).run();

    // Insert old core fact (should NOT be pruned by screen rule)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('old-core', 'fact.core', 'important fact', datetime('now', '-40 days'), 'demo')
    `).run();

    const rules = [
        { type: 'context.screen', maxAgeDays: 7 }
    ];

    const deleted = await storage.pruneMemories(rules);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT id FROM memories').all() as any[];
    const ids = remaining.map(r => r.id);
    
    expect(ids).toContain('new-screen');
    expect(ids).toContain('old-core');
    expect(ids).not.toContain('old-screen');
  });

  it('should prune multiple types correctly', async () => {
    // Old chat log (31 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('old-chat', 'fact.conversation', 'old chat', datetime('now', '-31 days'), 'demo')
    `).run();

    // Recent chat log (29 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('recent-chat', 'fact.conversation', 'recent chat', datetime('now', '-29 days'), 'demo')
    `).run();

    const rules = [
        { type: 'fact.conversation', maxAgeDays: 30 }
    ];

    const deleted = await storage.pruneMemories(rules);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT id FROM memories').all() as any[];
    const ids = remaining.map(r => r.id);
    
    expect(ids).not.toContain('old-chat');
    expect(ids).toContain('recent-chat');
  });

  it('should prune commands after 7 days', async () => {
    // Old command (8 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('old-cmd', 'fact.command', 'open spotify', datetime('now', '-8 days'), 'demo')
    `).run();

    // Recent command (6 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('recent-cmd', 'fact.command', 'check mail', datetime('now', '-6 days'), 'demo')
    `).run();

    const rules = [
        { type: 'fact.command', maxAgeDays: 7 }
    ];

    const deleted = await storage.pruneMemories(rules);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT id FROM memories').all() as any[];
    const ids = remaining.map(r => r.id);
    
    expect(ids).not.toContain('old-cmd');
    expect(ids).toContain('recent-cmd');
  });

  it('should prune actions after 7 days', async () => {
    // Old action (8 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('old-action', 'fact.action', 'scrolled down', datetime('now', '-8 days'), 'demo')
    `).run();

    // Recent action (6 days ago)
    db.prepare(`
      INSERT INTO memories (id, type, content, created_at, workspace_id)
      VALUES ('recent-action', 'fact.action', 'clicked button', datetime('now', '-6 days'), 'demo')
    `).run();

    const rules = [
        { type: 'fact.action', maxAgeDays: 7 }
    ];

    const deleted = await storage.pruneMemories(rules);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT id FROM memories').all() as any[];
    const ids = remaining.map(r => r.id);
    
    expect(ids).not.toContain('old-action');
    expect(ids).toContain('recent-action');
  });
});
