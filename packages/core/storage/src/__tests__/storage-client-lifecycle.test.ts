import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageClient } from '../client.js';
import { Memory, LifecycleState } from '../models.js';

// Mock the adapters
vi.mock('../sqlite.js');
vi.mock('../vectorize.js');

describe('StorageClient Lifecycle Integration', () => {
    let client: StorageClient;
    let mockAdapter: any;
    let mockVectorize: any;
    const workspaceId = 'test-workspace';

    beforeEach(async () => {
        // Create mock adapter
        mockAdapter = {
            query: vi.fn(),
            insert: vi.fn(),
            delete: vi.fn(),
            update: vi.fn(),
        };

        // Create mock vectorize
        mockVectorize = {
            upsert: vi.fn(),
            search: vi.fn(),
            delete: vi.fn(),
        };

        // Create client with mocked dependencies
        client = new StorageClient({
            sqlite: { filename: ':memory:' },
            vectorize: { type: 'sqlite', path: ':memory:' },
        });

        // Replace the private adapter and vectorize with mocks
        (client as any).adapter = mockAdapter;
        (client as any).vectorize = mockVectorize;
    });

    describe('Lifecycle Field Initialization', () => {
        it('should initialize lifecycle fields on memory creation', async () => {
            const now = new Date();
            const mockMemory: Memory = {
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
                metadata: {},
                created_at: now,
                updated_at: now,
                lifecycle_state: 'active',
                last_accessed_at: now,
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: false,
                pinned_by: null,
                pinned_at: null,
                archived_at: null,
                expires_at: null,
            };

            mockAdapter.insert.mockResolvedValue({ ok: true, value: mockMemory });
            mockAdapter.query.mockResolvedValue({ ok: true, value: [{ id: workspaceId }] });

            const result = await client.createMemory({
                workspace_id: workspaceId,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(mockAdapter.insert).toHaveBeenCalledWith(
                    'memories',
                    expect.objectContaining({
                        lifecycle_state: 'active',
                        decay_score: 1.0,
                        access_count: 0,
                        importance_score: 0.5,
                        pinned: false,
                    })
                );
            }
        });
    });

    describe('Access Tracking', () => {
        it('should track access when memory is retrieved', async () => {
            const mockMemory: Memory = {
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                lifecycle_state: 'active',
                last_accessed_at: new Date(),
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: false,
                pinned_by: null,
                pinned_at: null,
                archived_at: null,
                expires_at: null,
            };

            mockAdapter.query.mockResolvedValue({ ok: true, value: [mockMemory] });

            const result = await client.getMemory('mem-1', workspaceId);

            expect(result.ok).toBe(true);

            // Verify access tracking UPDATE was called (non-blocking)
            // We need to wait a tick for the non-blocking call
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE memories'),
                expect.arrayContaining([expect.any(String), 'mem-1'])
            );
        });
    });

    describe('State-Based Queries', () => {
        it('should query memories by lifecycle state', async () => {
            const mockMemories: Memory[] = [{
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Active memory',
                confidence: 0.9,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                lifecycle_state: 'active',
                last_accessed_at: new Date(),
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: false,
                pinned_by: null,
                pinned_at: null,
                archived_at: null,
                expires_at: null,
            }];

            mockAdapter.query.mockResolvedValue({ ok: true, value: mockMemories });

            const result = await client.getMemoriesByLifecycleState(workspaceId, 'active');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBe(1);
                expect(result.value[0].lifecycle_state).toBe('active');
            }

            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('lifecycle_state'),
                [workspaceId, 'active', 50, 0]
            );
        });

        it('should validate lifecycle state parameter', async () => {
            const result = await client.getMemoriesByLifecycleState(workspaceId, 'invalid' as LifecycleState);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.type).toBe('validation');
                expect(result.error.field).toBe('state');
            }
        });
    });

    describe('Manual Lifecycle Updates', () => {
        it('should update lifecycle state', async () => {
            const updatedMemory: Memory = {
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                lifecycle_state: 'decaying',
                last_accessed_at: new Date(),
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: false,
                pinned_by: null,
                pinned_at: null,
                archived_at: null,
                expires_at: null,
            };

            mockAdapter.query.mockResolvedValue({ ok: true, value: [updatedMemory] });

            const result = await client.updateMemoryLifecycle(
                'mem-1',
                workspaceId,
                { lifecycle_state: 'decaying' }
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.lifecycle_state).toBe('decaying');
            }

            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE memories'),
                expect.any(Array)
            );
        });

        it('should validate score ranges', async () => {
            const result = await client.updateMemoryLifecycle(
                'mem-1',
                workspaceId,
                { importance_score: 1.5 }
            );

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.type).toBe('validation');
                expect(result.error.field).toBe('importance_score');
            }
        });

        it('should handle pinning correctly', async () => {
            const pinnedMemory: Memory = {
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                lifecycle_state: 'active',
                last_accessed_at: new Date(),
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: true,
                pinned_by: null,
                pinned_at: new Date(),
                archived_at: null,
                expires_at: null,
            };

            mockAdapter.query.mockResolvedValue({ ok: true, value: [pinnedMemory] });

            const result = await client.updateMemoryLifecycle(
                'mem-1',
                workspaceId,
                { pinned: true }
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.pinned).toBe(true);
                expect(result.value.pinned_at).toBeInstanceOf(Date);
            }
        });
    });

    describe('Archived Memory Search', () => {
        it('should search only active memories by default', async () => {
            const mockMemory: Memory = {
                id: 'mem-1',
                workspace_id: workspaceId,
                conversation_id: null,
                type: 'fact',
                content: 'Test memory',
                confidence: 0.9,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                lifecycle_state: 'active',
                last_accessed_at: new Date(),
                access_count: 0,
                importance_score: 0.5,
                decay_score: 1.0,
                effective_ttl: null,
                pinned: false,
                pinned_by: null,
                pinned_at: null,
                archived_at: null,
                expires_at: null,
            };

            mockVectorize.search.mockResolvedValue({
                ok: true,
                value: [{ id: 'mem-1', score: 0.95 }],
            });

            mockAdapter.query.mockResolvedValue({
                ok: true,
                value: [mockMemory],
            });

            const result = await client.searchMemories(workspaceId, {
                vector: [0.1, 0.2, 0.3],
                limit: 10,
            });

            expect(result.ok).toBe(true);
            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM memories'),
                expect.any(Array)
            );
            expect(mockAdapter.query).not.toHaveBeenCalledWith(
                expect.stringContaining('UNION'),
                expect.any(Array)
            );
        });

        it('should include archived memories when flag is true', async () => {
            mockVectorize.search.mockResolvedValue({
                ok: true,
                value: [{ id: 'mem-1', score: 0.95 }],
            });

            mockAdapter.query.mockResolvedValue({
                ok: true,
                value: [],
            });

            const result = await client.searchMemories(workspaceId, {
                vector: [0.1, 0.2, 0.3],
                limit: 10,
                includeArchived: true,
            });

            expect(result.ok).toBe(true);
            expect(mockAdapter.query).toHaveBeenCalledWith(
                expect.stringContaining('UNION'),
                expect.any(Array)
            );
        });
    });
});
