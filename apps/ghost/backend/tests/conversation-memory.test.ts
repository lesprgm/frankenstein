import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SQLiteStorage } from '../src/services/sqlite-storage.js';
import fs from 'node:fs';

describe('Conversation Memory (Sliding Window)', () => {
    let storage: SQLiteStorage;
    const dbPath = ':memory:';

    beforeEach(() => {
        storage = new SQLiteStorage(dbPath);
        // Ensure user exists
        (storage as any).ensureUserAndWorkspace('test-user');
    });

    it('should save and retrieve conversation turns', async () => {
        await storage.saveConversationTurn('test-user', 'Hello', 'Hi there');
        
        const history = storage.getRecentConversationTurns('test-user');
        expect(history).toHaveLength(1);
        expect(history[0].summary).toContain('User: Hello');
        expect(history[0].summary).toContain('Ghost: Hi there');
        expect(history[0].type).toBe('fact.conversation');
    });

    it('should respect the time window (10 minutes)', async () => {
        // Mock Date.now to control time
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Save a turn "now"
        await storage.saveConversationTurn('test-user', 'Recent', 'Response');

        // Move time forward 11 minutes
        vi.setSystemTime(now + 11 * 60 * 1000);

        // Should not retrieve it
        const history = storage.getRecentConversationTurns('test-user', 5, 10);
        expect(history).toHaveLength(0);
    });

    it('should retrieve multiple turns in order', async () => {
        const now = Date.now();
        vi.useFakeTimers();
        
        vi.setSystemTime(now);
        await storage.saveConversationTurn('test-user', 'First', 'R1');
        
        vi.setSystemTime(now + 1000);
        await storage.saveConversationTurn('test-user', 'Second', 'R2');

        const history = storage.getRecentConversationTurns('test-user');
        expect(history).toHaveLength(2);
        expect(history[0].summary).toContain('First');
        expect(history[1].summary).toContain('Second');
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});
