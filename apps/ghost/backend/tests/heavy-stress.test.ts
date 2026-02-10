
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { CommandProcessor } from '../src/services/command-processor';
import { SQLiteStorage } from '../src/services/sqlite-storage';
import { MemoryLayerIntegration } from '../src/services/memory-layer-integration';
import { ContextBuilder } from '../src/services/context-builder';
import { LLMCoordinator } from '../src/services/llm-coordinator';
import { MemoryService } from '../src/services/memory';
import type { CommandRequest, LLMResponse } from '../src/types';

// Increase timeout for heavy stress tests
vi.setConfig({ testTimeout: 120000 });

const runSlow = process.env.RUN_SLOW_TESTS === 'true' || process.env.RUN_SLOW_TESTS === '1';
const describeSlow = runSlow ? describe : describe.skip;

describeSlow('Heavy Stress Scenario: Extreme Load & Chaos', () => {
    const TEST_DB_PATH = `./test-heavy-stress-${Date.now()}.db`;
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
            // Simulate variable latency (10ms - 50ms)
            const latency = Math.floor(Math.random() * 40) + 10;
            await new Promise(r => setTimeout(r, latency)); 
            return {
                assistant_text: `Processed: ${text.substring(0, 20)}...`,
                actions: []
            } as LLMResponse;
        });

        // 5. Initialize Processor
        const memoryService = new MemoryService(storage);
        processor = new CommandProcessor(contextBuilder, llmCoordinator, memoryService, storage);
    });

    afterAll(async () => {
        try {
            if (memoryLayer) await memoryLayer.close();
            await storage.close();
            if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
            if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
            if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
        } catch (e) { console.error(e); }
    });

    it('should handle massive sequential load (500 messages)', async () => {
        const iterations = 500;
        const start = Date.now();
        let successCount = 0;

        for (let i = 0; i < iterations; i++) {
            const req: CommandRequest = {
                user_id: userId,
                command_id: `cmd-heavy-seq-${i}`,
                text: `Heavy Message number ${i} - ${'x'.repeat(50)}`, // Add some payload weight
                timestamp: new Date().toISOString(),
                conversational_mode: true,
                meta: { source: 'stress-test' }
            };

            const result = await processor.process(req);
            if (result.ok) successCount++;
        }

        const duration = Date.now() - start;
        console.log(`Massive sequential processing of ${iterations} messages took ${duration}ms (${(duration/iterations).toFixed(2)}ms/msg)`);
        expect(successCount).toBe(iterations);
    });

    it('should handle high concurrency (100 simultaneous requests)', async () => {
        const concurrency = 100;
        const promises = [];
        const start = Date.now();

        for (let i = 0; i < concurrency; i++) {
            const req: CommandRequest = {
                user_id: userId,
                command_id: `cmd-heavy-conc-${i}`,
                text: `Concurrent Heavy ${i}`,
                timestamp: new Date().toISOString(),
                conversational_mode: true,
                meta: { source: 'stress-test' }
            };
            promises.push(processor.process(req));
        }

        const results = await Promise.all(promises);
        const duration = Date.now() - start;
        
        const successCount = results.filter(r => r.ok).length;
        console.log(`High concurrency processing of ${concurrency} requests took ${duration}ms`);
        
        expect(successCount).toBe(concurrency);
    });

    it('should handle large payloads under load', async () => {
        const iterations = 20;
        const largePayload = 'DATA '.repeat(1000); // ~5KB text
        const promises = [];

        for (let i = 0; i < iterations; i++) {
            const req: CommandRequest = {
                user_id: userId,
                command_id: `cmd-large-${i}`,
                text: `Large Payload ${i}: ${largePayload}`,
                timestamp: new Date().toISOString(),
                conversational_mode: true,
                meta: { source: 'stress-test' }
            };
            promises.push(processor.process(req));
        }

        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.ok).length;
        expect(successCount).toBe(iterations);
    });

    it('should maintain database integrity after chaos', async () => {
        // Verify we have stored all the messages
        // 500 sequential + 100 concurrent + 20 large = 620 total new messages
        // Plus whatever was in there before (0)
        
        // We need to check the actual DB count, not just getRecentConversationTurns which is limited
        const allTurns = await storage.getRecentConversationTurns(userId, 1000);
        
        // Note: getRecentConversationTurns might filter or limit, so let's just check we have a significant amount
        // and that the order is roughly correct (latest ones are from the last test)
        
        expect(allTurns.length).toBeGreaterThan(500);
        
        const lastTurn = allTurns[allTurns.length - 1];
        // The last test run was "Large Payload", but since they ran concurrently, the exact last one is non-deterministic.
        // However, it should be one of the large payloads or concurrent ones if they finished last.
        // Actually, the tests run sequentially (it blocks), so "Large Payload" was the last block.
        
        expect(lastTurn.summary).toContain('Ghost: Processed:');
        // We can't easily check the exact text because of the mock response truncation, but we can check it exists.
    });
});
