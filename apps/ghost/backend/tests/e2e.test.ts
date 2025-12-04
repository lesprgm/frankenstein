import { describe, it, expect, vi, beforeEach } from 'vitest';
import { llmCoordinator } from '../src/services/llm-coordinator.js';
import { storageService } from '../src/services/storage.js';

// Mock the LLM coordinator to avoid external calls and ensure deterministic results
vi.mock('../src/services/llm-coordinator.js', () => ({
    llmCoordinator: {
        generateResponse: vi.fn(),
    },
}));

// Mock the auth middleware to bypass checks
vi.mock('../src/middleware/auth.js', () => ({
    requireApiKey: async (c: any, next: any) => await next(),
}));

// Use test-specific database
process.env.DATABASE_PATH = ':memory:';

// Import app after mocks and env setup
import app from '../src/index.js';

describe('Ghost Backend E2E', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Avoid intent guard short-circuit in tests; let the mocked LLM handle actions
        if (typeof (storageService as any).findFileByNameOrPath === 'function') {
            vi.spyOn(storageService as any, 'findFileByNameOrPath').mockResolvedValue([]);
        }
    });

    describe('POST /api/command', () => {
        it('should process a basic command and return actions', async () => {
            const payload = {
                command_id: `cmd-test-${Date.now()}`,
                text: 'Open test.txt',
                user_id: 'user-1',
                timestamp: new Date().toISOString(),
            };

            const res = await app.request('/api/command', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.actions).toBeInstanceOf(Array);
            expect(body.actions[0]).toMatchObject({
                type: 'file.open',
                params: { path: expect.any(String) },
            });
            // Intent guard may bypass LLM; ensure we don't require a call
            expect(llmCoordinator.generateResponse).toHaveBeenCalledTimes(0);
        });

        it('should handle LLM errors gracefully', async () => {
            vi.mocked(llmCoordinator.generateResponse).mockRejectedValue(new Error('LLM failure'));

            const payload = {
                command_id: 'cmd-error',
                text: 'Break things',
                user_id: 'user-1',
                timestamp: new Date().toISOString(),
            };

            const res = await app.request('/api/command', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Failed to process command');
        });

        it('should validate request body', async () => {
            const res = await app.request('/api/command', {
                method: 'POST',
                body: JSON.stringify({}), // Empty body
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Dashboard Integration', () => {
        it('should retrieve stored commands via dashboard API', async () => {
            // 1. Send a command
            const mockResponse = {
                assistant_text: 'Dashboard test',
                actions: [],
            };
            vi.mocked(llmCoordinator.generateResponse).mockResolvedValue(mockResponse);

            const cmdId = `cmd-dash-${Date.now()}`;
            await app.request('/api/command', {
                method: 'POST',
                body: JSON.stringify({
                    command_id: cmdId,
                    text: 'Dashboard check',
                    user_id: 'user-1',
                    timestamp: new Date().toISOString(),
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            // 2. Fetch dashboard data
            const res = await app.request('/api/dashboard/commands?limit=10');
            expect(res.status).toBe(200);
            const data = await res.json();

            // 3. Verify command is present
            expect(data.commands).toBeInstanceOf(Array);
            const found = data.commands.find((c: any) => c.id === cmdId);
            expect(found).toBeDefined();
            expect(found.text).toBe('Dashboard check');
            expect(found.assistant_text).toBe('Dashboard test');
        });

        it('should retrieve stats', async () => {
            const res = await app.request('/api/dashboard/stats');
            expect(res.status).toBe(200);
            const stats = await res.json();

            expect(stats).toHaveProperty('totalCommands');
            expect(stats).toHaveProperty('totalMemories');
            expect(stats).toHaveProperty('successRate');
            expect(typeof stats.totalCommands).toBe('number');
        });
    });

    describe('Storage Persistence', () => {
        it('should persist memories associated with commands', async () => {
            const saveSpy = vi.spyOn(storageService, 'saveCommand');

            const mockResponse = {
                assistant_text: 'Memory test',
                actions: [],
            };
            vi.mocked(llmCoordinator.generateResponse).mockResolvedValue(mockResponse);

            await app.request('/api/command', {
                method: 'POST',
                body: JSON.stringify({
                    command_id: 'cmd-mem-1',
                    text: 'Remember this',
                    user_id: 'user-1',
                    timestamp: new Date().toISOString(),
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(saveSpy).toHaveBeenCalled();
        });
    });
});
