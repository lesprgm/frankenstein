/**
 * LifecycleManager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../sqlite.js';
import { VectorizeAdapter } from '../vectorize.js';
import { LifecycleManager, LifecycleConfig } from '../lifecycle/lifecycle-manager.js';
import { DECAY_FUNCTIONS } from '../lifecycle/decay-calculator.js';
import { Memory } from '../models.js';

describe('LifecycleManager', () => {
  let adapter: SqliteAdapter;
  let vectorize: VectorizeAdapter;
  let lifecycleManager: LifecycleManager;
  let config: LifecycleConfig;

  beforeEach(async () => {
    // Create in-memory SQLite adapter for testing
    adapter = new SqliteAdapter({ filename: ':memory:' });

    // Create mock vectorize adapter
    vectorize = {
      upsert: async () => ({ ok: true, value: undefined }),
      search: async () => ({ ok: true, value: [] }),
      delete: async () => ({ ok: true, value: undefined }),
    } as any;

    // Create tables manually for testing
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      )
    `);

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0,
        importance_score REAL NOT NULL DEFAULT 0.5,
        decay_score REAL NOT NULL DEFAULT 1.0,
        effective_ttl INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_by TEXT,
        pinned_at TEXT,
        archived_at TEXT,
        expires_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_memory_id TEXT NOT NULL,
        to_memory_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS archived_memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL,
        importance_score REAL NOT NULL,
        archived_at TEXT NOT NULL,
        expires_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        previous_state TEXT NOT NULL,
        new_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        user_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create lifecycle config
    config = {
      enabled: true,
      defaultTTL: 90 * 24 * 60 * 60 * 1000, // 90 days
      retentionPolicies: new Map([
        ['entity', { ttl: 180 * 24 * 60 * 60 * 1000, importanceMultiplier: 2.0, gracePeriod: 7 * 24 * 60 * 60 * 1000 }],
        ['fact', { ttl: 90 * 24 * 60 * 60 * 1000, importanceMultiplier: 1.5, gracePeriod: 7 * 24 * 60 * 60 * 1000 }],
      ]),
      decayFunction: DECAY_FUNCTIONS.exponential(0.1),
      decayThreshold: 0.3,
      importanceWeights: {
        accessFrequency: 0.5,
        confidence: 0.3,
        relationshipCount: 0.2,
      },
      evaluationInterval: 60 * 60 * 1000, // 1 hour
      batchSize: 1000,
      archiveRetentionPeriod: 365 * 24 * 60 * 60 * 1000, // 1 year
      auditRetentionPeriod: 90 * 24 * 60 * 60 * 1000, // 90 days
    };

    lifecycleManager = new LifecycleManager(adapter, vectorize, config);
  });

  afterEach(() => {
    if (lifecycleManager) {
      lifecycleManager.stopBackgroundJobs();
    }
  });

  describe('recordAccess', () => {
    it('should update access count and importance score', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';
      const memoryId = 'test-memory-id';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata) VALUES ($1, $2, $3, $4, $5, $6)`, [memoryId, workspaceId, 'fact', 'Test memory', 0.9, '{}']);

      // Record access
      const result = await lifecycleManager.recordAccess(memoryId, workspaceId);
      expect(result.ok).toBe(true);

      // Verify memory was updated
      const updatedMemory = await adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1',
        [memoryId]
      );
      expect(updatedMemory.ok).toBe(true);
      expect(updatedMemory.value[0].access_count).toBe(1);
      expect(updatedMemory.value[0].importance_score).toBeGreaterThan(0);
    });

    it('should return error for non-existent memory', async () => {
      const result = await lifecycleManager.recordAccess('non-existent', 'workspace-id');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('not_found');
      }
    });
  });

  describe('pinMemory', () => {
    it('should pin a memory and prevent automatic transitions', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';
      const memoryId = 'test-memory-id';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata) VALUES ($1, $2, $3, $4, $5, $6)`, [memoryId, workspaceId, 'fact', 'Important memory', 0.9, '{}']);

      // Pin memory
      const result = await lifecycleManager.pinMemory(memoryId, workspaceId, userId);
      expect(result.ok).toBe(true);

      // Verify memory was pinned
      const pinnedMemory = await adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1',
        [memoryId]
      );
      expect(pinnedMemory.ok).toBe(true);
      expect(pinnedMemory.value[0].lifecycle_state).toBe('pinned');
      expect(pinnedMemory.value[0].pinned).toBe(1);
      expect(pinnedMemory.value[0].pinned_by).toBe(userId);
    });
  });

  describe('unpinMemory', () => {
    it('should unpin a memory and resume lifecycle management', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';
      const memoryId = 'test-memory-id';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata, lifecycle_state, pinned, pinned_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [memoryId, workspaceId, 'fact', 'Important memory', 0.9, '{}', 'pinned', 1, userId]);

      // Unpin memory
      const result = await lifecycleManager.unpinMemory(memoryId, workspaceId);
      expect(result.ok).toBe(true);

      // Verify memory was unpinned
      const unpinnedMemory = await adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1',
        [memoryId]
      );
      expect(unpinnedMemory.ok).toBe(true);
      expect(unpinnedMemory.value[0].lifecycle_state).not.toBe('pinned');
      expect(unpinnedMemory.value[0].pinned).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return lifecycle metrics for a workspace', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);
      
      // Create some memories
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata, lifecycle_state) VALUES ($1, $2, $3, $4, $5, $6, $7)`, ['memory-1', workspaceId, 'fact', 'Memory 1', 0.9, '{}', 'active']);
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata, lifecycle_state) VALUES ($1, $2, $3, $4, $5, $6, $7)`, ['memory-2', workspaceId, 'fact', 'Memory 2', 0.8, '{}', 'decaying']);

      // Get metrics
      const result = await lifecycleManager.getMetrics(workspaceId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalMemories).toBe(2);
        expect(result.value.stateCounts.active).toBe(1);
        expect(result.value.stateCounts.decaying).toBe(1);
      }
    });
  });

  describe('evaluateBatch', () => {
    it('should evaluate memories and update lifecycle states', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);

      // Create a memory with old last_accessed_at to trigger decay
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata, lifecycle_state, last_accessed_at, access_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, ['old-memory', workspaceId, 'fact', 'Old memory', 0.9, '{}', 'active', oldDate.toISOString(), 0]);

      // Evaluate batch
      const result = await lifecycleManager.evaluateBatch(workspaceId, 0, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.memoriesEvaluated).toBe(1);
        // The memory should have been evaluated and possibly transitioned
      }
    });

    it('should skip pinned memories during evaluation', async () => {
      // Create test data using direct SQL
      const userId = 'test-user-id';
      const workspaceId = 'test-workspace-id';
      const memoryId = 'pinned-memory';

      await adapter.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [userId, 'test@example.com', 'Test User']);
      await adapter.query(`INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)`, [workspaceId, 'Test Workspace', 'personal', userId]);

      // Create a pinned memory with old last_accessed_at
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      await adapter.query(`INSERT INTO memories (id, workspace_id, type, content, confidence, metadata, lifecycle_state, pinned, last_accessed_at, access_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [memoryId, workspaceId, 'fact', 'Pinned memory', 0.9, '{}', 'pinned', 1, oldDate.toISOString(), 0]);

      // Evaluate batch
      const result = await lifecycleManager.evaluateBatch(workspaceId, 0, 10);
      expect(result.ok).toBe(true);

      // Verify pinned memory state didn't change
      const memory = await adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1',
        [memoryId]
      );
      expect(memory.ok).toBe(true);
      expect(memory.value[0].lifecycle_state).toBe('pinned');
    });
  });

  describe('background jobs', () => {
    it('should start and stop background jobs', () => {
      // Start jobs
      lifecycleManager.startBackgroundJobs();

      // Stop jobs
      lifecycleManager.stopBackgroundJobs();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
