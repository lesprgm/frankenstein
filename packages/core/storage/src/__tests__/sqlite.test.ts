/**
 * Unit tests for SqliteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../sqlite.js';
import fs from 'fs';
import path from 'path';

describe('SqliteAdapter', () => {
    let adapter: SqliteAdapter;
    const testDbPath = path.join('/tmp', `test-${Date.now()}.db`);

    beforeEach(async () => {
        // Create a new SQLite adapter with a temporary database
        adapter = new SqliteAdapter({
            filename: testDbPath,
        });

        // Create a simple users table for testing
        await adapter.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        // Create a workspaces table for testing
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

        // Create a memories table for testing
        await adapter.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )
    `);
    });

    afterEach(() => {
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    describe('query', () => {
        it('should execute SELECT query successfully', async () => {
            // Insert test data
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            const result = await adapter.query<{ id: string; email: string; name: string }>(
                'SELECT * FROM users WHERE id = ?',
                ['user-1']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(1);
                expect(result.value[0].email).toBe('test@example.com');
            }
        });

        it('should handle SELECT queries with no results', async () => {
            const result = await adapter.query<{ id: string; email: string; name: string }>(
                'SELECT * FROM users WHERE id = ?',
                ['nonexistent']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(0);
            }
        });

        it('should handle query errors', async () => {
            const result = await adapter.query<unknown>('SELECT * FROM nonexistent_table', []);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.type).toBe('database');
            }
        });

        it('should convert Postgres-style parameters to SQLite', async () => {
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Use $1 style parameters (Postgres style)
            const result = await adapter.query<{ id: string; email: string; name: string }>(
                'SELECT * FROM users WHERE email = $1',
                ['test@example.com']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(1);
            }
        });
    });

    describe('insert', () => {
        it('should insert record successfully', async () => {
            const result = await adapter.insert<{ id: string; email: string; name: string }>('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.id).toBe('user-1');
                expect(result.value.email).toBe('test@example.com');
                expect(result.value.name).toBe('Test User');
            }
        });

        it('should handle unique constraint violations', async () => {
            // Insert first record
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Try to insert duplicate email
            const result = await adapter.insert<{ id: string; email: string; name: string }>('users', {
                id: 'user-2',
                email: 'test@example.com',
                name: 'Another User',
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.type).toBe('conflict');
            }
        });

        it('should insert record with foreign key', async () => {
            // Create user first
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Create workspace
            const result = await adapter.insert<{ id: string; owner_id: string }>('workspaces', {
                id: 'workspace-1',
                name: 'Test Workspace',
                type: 'personal',
                owner_id: 'user-1',
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.id).toBe('workspace-1');
                expect(result.value.owner_id).toBe('user-1');
            }
        });
    });

    describe('update', () => {
        it('should update record successfully', async () => {
            // Insert test record
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Update the record
            const result = await adapter.update<{ id: string; email: string; name: string }>('users', 'user-1', {
                name: 'Updated User',
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.name).toBe('Updated User');
                expect(result.value.email).toBe('test@example.com'); // unchanged
            }
        });

        it('should handle not found errors', async () => {
            const result = await adapter.update<unknown>('users', 'nonexistent', {
                name: 'Updated User',
            });

            expect(result.ok).toBe(false);
            if (!result.ok && result.error.type === 'not_found') {
                expect(result.error.type).toBe('not_found');
                expect(result.error.resource).toBe('users');
                expect(result.error.id).toBe('nonexistent');
            }
        });
    });

    describe('delete', () => {
        it('should delete record successfully', async () => {
            // Insert test record
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Delete the record
            const result = await adapter.delete('users', 'user-1');

            expect(result.ok).toBe(true);

            // Verify it's deleted
            const queryResult = await adapter.query<{ id: string }>(
                'SELECT * FROM users WHERE id = ?',
                ['user-1']
            );
            if (queryResult.ok) {
                expect(queryResult.value).toHaveLength(0);
            }
        });

        it('should succeed even when record does not exist', async () => {
            const result = await adapter.delete('users', 'nonexistent');

            expect(result.ok).toBe(true);
        });
    });

    describe('transactions', () => {
        it('should commit transaction successfully', async () => {
            const txResult = await adapter.beginTransaction();

            expect(txResult.ok).toBe(true);
            if (txResult.ok) {
                const tx = txResult.value;

                // Insert within transaction
                await tx.insert('users', {
                    id: 'user-1',
                    email: 'test@example.com',
                    name: 'Test User',
                });

                // Commit
                await tx.commit();

                // Verify data persisted
                const queryResult = await adapter.query<{ id: string }>(
                    'SELECT * FROM users WHERE id = ?',
                    ['user-1']
                );
                if (queryResult.ok) {
                    expect(queryResult.value).toHaveLength(1);
                }
            }
        });

        it('should rollback transaction on error', async () => {
            const txResult = await adapter.beginTransaction();

            expect(txResult.ok).toBe(true);
            if (txResult.ok) {
                const tx = txResult.value;

                // Insert within transaction
                await tx.insert('users', {
                    id: 'user-1',
                    email: 'test@example.com',
                    name: 'Test User',
                });

                // Rollback instead of commit
                await tx.rollback();

                // Verify data was not persisted
                const queryResult = await adapter.query<{ id: string }>(
                    'SELECT * FROM users WHERE id = ?',
                    ['user-1']
                );
                if (queryResult.ok) {
                    expect(queryResult.value).toHaveLength(0);
                }
            }
        });
    });

    describe('complex queries', () => {
        beforeEach(async () => {
            // Create user
            await adapter.insert('users', {
                id: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
            });

            // Create workspace
            await adapter.insert('workspaces', {
                id: 'workspace-1',
                name: 'Test Workspace',
                type: 'personal',
                owner_id: 'user-1',
            });

            // Create multiple memories
            for (let i = 1; i <= 5; i++) {
                await adapter.insert('memories', {
                    id: `memory-${i}`,
                    workspace_id: 'workspace-1',
                    conversation_id: null,
                    type: 'fact',
                    content: `Test memory ${i}`,
                    confidence: 0.8 + i * 0.02,
                    metadata: JSON.stringify({ index: i }),
                });
            }
        });

        it('should query memories by workspace', async () => {
            const result = await adapter.query<{
                id: string;
                workspace_id: string;
                content: string;
                confidence: number;
            }>(
                'SELECT * FROM memories WHERE workspace_id = ? ORDER BY confidence DESC',
                ['workspace-1']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(5);
                expect(result.value[0].confidence).toBeGreaterThan(result.value[4].confidence);
            }
        });

        it('should query with LIKE operator', async () => {
            const result = await adapter.query<{
                id: string;
                content: string;
            }>(
                'SELECT * FROM memories WHERE content LIKE ?',
                ['%memory 3%']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(1);
                expect(result.value[0].content).toBe('Test memory 3');
            }
        });

        it('should join tables', async () => {
            const result = await adapter.query<{
                id: string;
                workspace_name: string;
            }>(
                `SELECT m.*, w.name as workspace_name 
         FROM memories m 
         JOIN workspaces w ON m.workspace_id = w.id 
         WHERE m.id = ?`,
                ['memory-1']
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(1);
                expect(result.value[0].workspace_name).toBe('Test Workspace');
            }
        });
    });
});
