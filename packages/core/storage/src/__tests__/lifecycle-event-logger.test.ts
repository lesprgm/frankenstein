/**
 * Unit tests for LifecycleEventLogger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LifecycleEventLogger } from '../lifecycle/lifecycle-event-logger.js';
import { SqliteAdapter } from '../sqlite.js';
import { LifecycleState } from '../models.js';
import { randomUUID } from 'crypto';

describe('LifecycleEventLogger', () => {
  let adapter: SqliteAdapter;
  let logger: LifecycleEventLogger;
  let testWorkspaceId: string;
  let testMemoryId: string;

  beforeEach(async () => {
    // Create in-memory SQLite adapter for testing
    adapter = new SqliteAdapter({ filename: ':memory:' });
    
    // Create tables manually for testing
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);
    
    logger = new LifecycleEventLogger(adapter);
    
    // Create test workspace and memory
    testWorkspaceId = randomUUID();
    testMemoryId = randomUUID();
    
    // Insert test workspace
    await adapter.insert('workspaces', {
      id: testWorkspaceId,
      name: 'Test Workspace',
      type: 'personal',
      owner_id: randomUUID(),
    });
    
    // Insert test memory
    await adapter.insert('memories', {
      id: testMemoryId,
      workspace_id: testWorkspaceId,
      type: 'fact',
      content: 'Test memory',
      confidence: 0.9,
      metadata: {},
    });
  });

  describe('logTransition', () => {
    it('should successfully log a lifecycle transition', async () => {
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Decay score fell below threshold',
        triggered_by: 'system',
      });

      expect(result.ok).toBe(true);
    });

    it('should log user-triggered transitions with user_id', async () => {
      const userId = randomUUID();
      
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'pinned',
        reason: 'User pinned memory',
        triggered_by: 'user',
        user_id: userId,
      });

      expect(result.ok).toBe(true);
      
      // Verify the event was logged with user_id
      const history = await logger.getHistory(testMemoryId, testWorkspaceId);
      expect(history.ok).toBe(true);
      if (history.ok) {
        expect(history.value).toHaveLength(1);
        expect(history.value[0].user_id).toBe(userId);
        expect(history.value[0].triggered_by).toBe('user');
      }
    });

    it('should log transitions with metadata', async () => {
      const metadata = {
        decay_score: 0.25,
        importance_score: 0.8,
        ttl_remaining: 3600000,
      };
      
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Decay score fell below threshold',
        triggered_by: 'system',
        metadata,
      });

      expect(result.ok).toBe(true);
      
      // Verify metadata was stored
      const history = await logger.getHistory(testMemoryId, testWorkspaceId);
      expect(history.ok).toBe(true);
      if (history.ok) {
        expect(history.value[0].metadata).toEqual(metadata);
      }
    });

    it('should reject transition with missing memory_id', async () => {
      const result = await logger.logTransition({
        memory_id: '',
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Test',
        triggered_by: 'system',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('memory_id');
      }
    });

    it('should reject transition with missing workspace_id', async () => {
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: '',
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Test',
        triggered_by: 'system',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('workspace_id');
      }
    });

    it('should reject transition with missing reason', async () => {
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: '',
        triggered_by: 'system',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('reason');
      }
    });

    it('should reject transition with invalid triggered_by', async () => {
      const result = await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Test',
        triggered_by: 'invalid' as any,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('triggered_by');
      }
    });
  });

  describe('getHistory', () => {
    it('should return empty array for memory with no transitions', async () => {
      const result = await logger.getHistory(testMemoryId, testWorkspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return transitions in chronological order', async () => {
      // Log multiple transitions
      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'First transition',
        triggered_by: 'system',
      });

      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'decaying',
        new_state: 'archived',
        reason: 'Second transition',
        triggered_by: 'system',
      });

      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'archived',
        new_state: 'active',
        reason: 'Third transition',
        triggered_by: 'user',
      });

      const result = await logger.getHistory(testMemoryId, testWorkspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0].reason).toBe('First transition');
        expect(result.value[1].reason).toBe('Second transition');
        expect(result.value[2].reason).toBe('Third transition');
        
        // Verify chronological order
        expect(result.value[0].created_at.getTime()).toBeLessThanOrEqual(
          result.value[1].created_at.getTime()
        );
        expect(result.value[1].created_at.getTime()).toBeLessThanOrEqual(
          result.value[2].created_at.getTime()
        );
      }
    });

    it('should only return transitions for specified memory', async () => {
      const otherMemoryId = randomUUID();
      
      // Insert another memory
      await adapter.insert('memories', {
        id: otherMemoryId,
        workspace_id: testWorkspaceId,
        type: 'fact',
        content: 'Other memory',
        confidence: 0.9,
        metadata: {},
      });

      // Log transitions for both memories
      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Test memory transition',
        triggered_by: 'system',
      });

      await logger.logTransition({
        memory_id: otherMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'pinned',
        reason: 'Other memory transition',
        triggered_by: 'user',
      });

      const result = await logger.getHistory(testMemoryId, testWorkspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].memory_id).toBe(testMemoryId);
        expect(result.value[0].reason).toBe('Test memory transition');
      }
    });

    it('should reject with missing memory_id', async () => {
      const result = await logger.getHistory('', testWorkspaceId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('memoryId');
      }
    });

    it('should reject with missing workspace_id', async () => {
      const result = await logger.getHistory(testMemoryId, '');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('workspaceId');
      }
    });
  });

  describe('getRecentTransitions', () => {
    it('should return recent transitions for workspace', async () => {
      // Log transitions
      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'Recent transition',
        triggered_by: 'system',
      });

      const result = await logger.getRecentTransitions(testWorkspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0].workspace_id).toBe(testWorkspaceId);
      }
    });

    it('should return transitions in reverse chronological order', async () => {
      // Log multiple transitions with slight delays
      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'active',
        new_state: 'decaying',
        reason: 'First',
        triggered_by: 'system',
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      await logger.logTransition({
        memory_id: testMemoryId,
        workspace_id: testWorkspaceId,
        previous_state: 'decaying',
        new_state: 'archived',
        reason: 'Second',
        triggered_by: 'system',
      });

      const result = await logger.getRecentTransitions(testWorkspaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        // Most recent first
        expect(result.value[0].reason).toBe('Second');
        expect(result.value[1].reason).toBe('First');
      }
    });

    it('should respect limit parameter', async () => {
      // Log 5 transitions
      for (let i = 0; i < 5; i++) {
        await logger.logTransition({
          memory_id: testMemoryId,
          workspace_id: testWorkspaceId,
          previous_state: 'active',
          new_state: 'decaying',
          reason: `Transition ${i}`,
          triggered_by: 'system',
        });
      }

      const result = await logger.getRecentTransitions(testWorkspaceId, 3);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('should use default limit of 100', async () => {
      const result = await logger.getRecentTransitions(testWorkspaceId);

      expect(result.ok).toBe(true);
      // Just verify it doesn't error with default limit
    });

    it('should reject with missing workspace_id', async () => {
      const result = await logger.getRecentTransitions('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation');
        expect(result.error.field).toBe('workspaceId');
      }
    });

    it('should reject with invalid limit', async () => {
      const resultTooLow = await logger.getRecentTransitions(testWorkspaceId, 0);
      expect(resultTooLow.ok).toBe(false);
      if (!resultTooLow.ok) {
        expect(resultTooLow.error.type).toBe('validation');
        expect(resultTooLow.error.field).toBe('limit');
      }

      const resultTooHigh = await logger.getRecentTransitions(testWorkspaceId, 1001);
      expect(resultTooHigh.ok).toBe(false);
      if (!resultTooHigh.ok) {
        expect(resultTooHigh.error.type).toBe('validation');
        expect(resultTooHigh.error.field).toBe('limit');
      }
    });
  });
});
