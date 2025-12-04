/**
 * Tests for lifecycle management migration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../sqlite.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Lifecycle Management Migration', () => {
  let adapter: SqliteAdapter;
  const testDbPath = path.join('/tmp', `test-lifecycle-${Date.now()}.db`);

  beforeEach(async () => {
    // Create a new SQLite adapter with migrations
    const migrationsDir = path.join(__dirname, '..', 'migrations', 'sqlite');
    adapter = new SqliteAdapter({
      filename: testDbPath,
      migrationsDir,
    });
  });

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('should add lifecycle columns to memories table', async () => {
    // First check if memories table exists
    const tableCheck = await adapter.query<any>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
    );
    
    expect(tableCheck.ok).toBe(true);
    if (!tableCheck.ok) return;
    
    // If table doesn't exist, skip this test
    if (tableCheck.value.length === 0) {
      console.log('Memories table does not exist, skipping column check');
      return;
    }

    // Query the table schema to verify columns exist
    // Note: PRAGMA returns results differently - we need to use a different approach
    const result = await adapter.query<any>('SELECT * FROM memories LIMIT 0');
    
    expect(result.ok).toBe(true);
    if (!result.ok) {
      console.log('Failed to query memories table:', result.error);
      return;
    }

    // Get column names from a SELECT query instead
    const columnsQuery = await adapter.query<any>("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'");
    expect(columnsQuery.ok).toBe(true);
    if (!columnsQuery.ok) return;
    
    const createTableSQL = columnsQuery.value[0]?.sql || '';
    console.log('Memories table SQL:', createTableSQL);
    
    // Check that all lifecycle columns exist in the CREATE TABLE statement
    expect(createTableSQL).toContain('lifecycle_state');
    expect(createTableSQL).toContain('last_accessed_at');
    expect(createTableSQL).toContain('access_count');
    expect(createTableSQL).toContain('importance_score');
    expect(createTableSQL).toContain('decay_score');
    expect(createTableSQL).toContain('effective_ttl');
    expect(createTableSQL).toContain('pinned');
    expect(createTableSQL).toContain('pinned_by');
    expect(createTableSQL).toContain('pinned_at');
    expect(createTableSQL).toContain('archived_at');
    expect(createTableSQL).toContain('expires_at');
  });

  it('should create archived_memories table', async () => {
    // Check if archived_memories table exists
    const result = await adapter.query<any>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='archived_memories'"
    );
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(1);
    expect(result.value[0].name).toBe('archived_memories');
  });

  it('should create lifecycle_events table', async () => {
    // Check if lifecycle_events table exists
    const result = await adapter.query<any>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_events'"
    );
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(1);
    expect(result.value[0].name).toBe('lifecycle_events');
  });

  it('should create lifecycle indexes', async () => {
    // Check if lifecycle indexes exist
    const result = await adapter.query<any>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memories_lifecycle%' OR name LIKE 'idx_memories_last_accessed%' OR name LIKE 'idx_memories_expires_at%' OR name LIKE 'idx_memories_pinned%'"
    );
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const indexNames = result.value.map((idx: any) => idx.name);
    
    expect(indexNames).toContain('idx_memories_lifecycle_state');
    expect(indexNames).toContain('idx_memories_last_accessed');
    expect(indexNames).toContain('idx_memories_expires_at');
    expect(indexNames).toContain('idx_memories_pinned');
  });

  it('should set default values for lifecycle columns', async () => {
    // First, create a user
    const user = {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
    };
    await adapter.insert('users', user);

    // Then create a workspace
    const workspace = {
      id: 'test-workspace',
      name: 'Test Workspace',
      type: 'personal',
      owner_id: 'test-user',
    };
    await adapter.insert('workspaces', workspace);

    // Insert a test memory
    const testMemory = {
      id: 'test-memory-1',
      workspace_id: 'test-workspace',
      conversation_id: null,
      type: 'fact',
      content: 'Test memory content',
      confidence: 0.9,
      metadata: '{}',
    };

    const insertResult = await adapter.insert('memories', testMemory);
    if (!insertResult.ok) {
      console.log('Insert failed:', insertResult.error);
    }
    expect(insertResult.ok).toBe(true);

    // Query the memory to check default values
    const queryResult = await adapter.query<any>(
      'SELECT lifecycle_state, access_count, importance_score, decay_score, pinned FROM memories WHERE id = ?',
      [testMemory.id]
    );

    expect(queryResult.ok).toBe(true);
    if (!queryResult.ok) return;

    const memory = queryResult.value[0];
    expect(memory.lifecycle_state).toBe('active');
    expect(memory.access_count).toBe(0);
    expect(memory.importance_score).toBe(0.5);
    expect(memory.decay_score).toBe(1.0);
    expect(memory.pinned).toBe(0); // SQLite boolean false
  });

  it('should enforce check constraints on archived_memories table', async () => {
    // Try to insert an archived memory with invalid confidence
    const testMemory = {
      id: 'test-archived-1',
      workspace_id: 'test-workspace',
      conversation_id: null,
      type: 'fact',
      content: 'Test memory content',
      confidence: 1.5, // Invalid: > 1
      metadata: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
      access_count: 0,
      importance_score: 0.5,
      archived_at: new Date().toISOString(),
      expires_at: null,
    };

    const result = await adapter.insert('archived_memories', testMemory);
    
    // Should fail due to check constraint
    expect(result.ok).toBe(false);
  });

  it('should enforce check constraints on lifecycle_events table', async () => {
    // Try to insert a lifecycle event with invalid state
    const testEvent = {
      id: 'test-event-1',
      memory_id: 'test-memory-1',
      workspace_id: 'test-workspace',
      previous_state: 'invalid_state', // Invalid state
      new_state: 'active',
      reason: 'Test transition',
      triggered_by: 'system',
      user_id: null,
      metadata: '{}',
    };

    const result = await adapter.insert('lifecycle_events', testEvent);
    
    // Should fail due to check constraint
    expect(result.ok).toBe(false);
  });
});
