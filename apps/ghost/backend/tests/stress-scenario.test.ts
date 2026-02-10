
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { CommandProcessor } from '../src/services/command-processor';
import { SQLiteStorage } from '../src/services/sqlite-storage';
import { MemoryLayerIntegration } from '../src/services/memory-layer-integration';
import { ContextBuilder } from '../src/services/context-builder';
import { LLMCoordinator } from '../src/services/llm-coordinator';
import { MemoryService } from '../src/services/memory';
import type { CommandRequest, LLMResponse } from '../src/types';

const runSlow = process.env.RUN_SLOW_TESTS === 'true' || process.env.RUN_SLOW_TESTS === '1';
const describeSlow = runSlow ? describe : describe.skip;

describeSlow('Stress Scenario: High Load & Concurrency', () => {
    const TEST_DB_PATH = `./test-stress-${Date.now()}.db`;
    let storage: SQLiteStorage;
    let memoryLayer: MemoryLayerIntegration;
    let contextBuilder: ContextBuilder;
    let llmCoordinator: LLMCoordinator;
    let processor: CommandProcessor;
    let userId: string;

    beforeAll(async () => {
        // 1. Setup Storage
        storage = new SQLiteStorage(TEST_DB_PATH);
        
        // 2. Setup Memory Layer
        memoryLayer = new MemoryLayerIntegration(TEST_DB_PATH, storage.storageClient);
        await memoryLayer.initialize();
        userId = memoryLayer.getWorkspaceId();

        // 3. Setup Context Builder
        contextBuilder = new ContextBuilder(memoryLayer);

        // 4. Mock LLM Coordinator
        llmCoordinator = new LLMCoordinator();
        vi.spyOn(llmCoordinator, 'generateResponse').mockImplementation(async (text) => {
            // Simulate slight latency
            await new Promise(r => setTimeout(r, 10)); 
            return {
                assistant_text: `Processed: ${text}`,
                actions: []
            } as LLMResponse;
        });

        // 5. Initialize Processor
        const memoryService = new MemoryService(storage);
        processor = new CommandProcessor(contextBuilder, llmCoordinator, memoryService, storage);
    });

    afterAll(() => {
        try {
            if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
            if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
            if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
        } catch (e) { console.error(e); }
    });

    it('should handle rapid-fire sequential messages (Chat Mode)', async () => {
        const iterations = 50;
        const start = Date.now();

        for (let i = 0; i < iterations; i++) {
            const req: CommandRequest = {
                user_id: userId,
                command_id: `cmd-seq-${i}`,
                text: `Message number ${i}`,
                timestamp: new Date().toISOString(),
                conversational_mode: true,
                meta: { source: 'voice', client_version: 'test' }
            };

            const result = await processor.process(req);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.assistant_text).toContain(`Processed: Message number ${i}`);
            }
        }

        const duration = Date.now() - start;
        console.log(`Sequential processing of ${iterations} messages took ${duration}ms (${duration/iterations}ms/msg)`);
    });

    it('should handle concurrent requests without crashing', async () => {
        const concurrency = 20;
        const promises = [];

        for (let i = 0; i < concurrency; i++) {
            const req: CommandRequest = {
                user_id: userId,
                command_id: `cmd-conc-${i}`,
                text: `Concurrent Message ${i}`,
                timestamp: new Date().toISOString(),
                conversational_mode: true,
                meta: { source: 'voice', client_version: 'test' }
            };
            promises.push(processor.process(req));
        }

        const results = await Promise.all(promises);
        
        results.forEach((res, i) => {
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.value.assistant_text).toContain(`Processed: Concurrent Message ${i}`);
            }
        });
        
        console.log(`Processed ${concurrency} concurrent requests successfully.`);
    });

    it('should maintain sliding window integrity under load', async () => {
        // Verify that after all the previous tests, the history is still retrievable
        // and limited to the last 10 minutes (which all tests ran within)
        
        // Request up to 100 items to verify we have them all
        const history = storage.getRecentConversationTurns(userId, 100);
        
        // We sent 50 sequential + 20 concurrent = 70 messages
        // The sliding window might return all of them if they fit in the time window
        // But let's just check that we have a significant number and they are ordered
        
        expect(history.length).toBeGreaterThan(50);
        
        // Check the last one is likely one of the concurrent ones or the last sequential one
        // (Order of concurrent execution isn't guaranteed, but sequential is)
        
        // Let's add one more distinct message to verify "latest"
        const finalReq: CommandRequest = {
            user_id: userId,
            command_id: `cmd-final`,
            text: `Final Check`,
            timestamp: new Date().toISOString(),
            conversational_mode: true,
            meta: { source: 'voice', client_version: 'test' }
        };
        
        await processor.process(finalReq);
        
        const updatedHistory = storage.getRecentConversationTurns(userId, 100);
        const lastTurn = updatedHistory[updatedHistory.length - 1];
        
        expect(lastTurn.summary).toContain('Final Check');
    });
});
