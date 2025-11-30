/**
 * Stress Tests for MAKER-enabled MemoryLayer
 * 
 * Tests system behavior under heavy load, concurrent operations, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { makerReliableExtractMemory, type MakerLLMProvider } from '../maker-extractor.js';

/**
 * Fast mock provider for stress testing (no delays)
 */
class StressMockProvider implements MakerLLMProvider {
    private callCount = 0;
    private failureRate: number;

    constructor(failureRate = 0) {
        this.failureRate = failureRate;
    }

    async call(_prompt: string, _options?: { temperature?: number; timeout?: number }): Promise<string> {
        this.callCount++;

        // Simulate random failures based on failure rate
        if (Math.random() < this.failureRate) {
            throw new Error(`Simulated failure (call ${this.callCount})`);
        }

        // Return valid response
        return JSON.stringify({
            summary: `Stress test extraction ${this.callCount}: User discussed implementation details and made technical decisions.`,
            decisions: [`Decision ${this.callCount % 5}`],
            todos: [`TODO ${this.callCount % 3}`]
        });
    }

    getCallCount() {
        return this.callCount;
    }

    reset() {
        this.callCount = 0;
    }
}

describe('MemoryLayer Stress Tests', () => {
    describe('Volume Testing', () => {
        it('should handle 100 sequential extractions without errors', async () => {
            const provider = new StressMockProvider(0);
            const results: any[] = [];

            const startTime = Date.now();

            for (let i = 0; i < 100; i++) {
                const result = await makerReliableExtractMemory(`Conversation ${i}`, provider);
                results.push(result);
            }

            const duration = Date.now() - startTime;

            // All should succeed
            expect(results.every(r => r !== null)).toBe(true);
            expect(provider.getCallCount()).toBe(300); // 100 extractions × 3 microagents

            console.log(`[Stress Test] 100 extractions in ${duration}ms (avg ${duration / 100}ms per extraction)`);
        }, 30000); // 30s timeout

        it('should handle very long input text (10,000+ chars)', async () => {
            const provider = new StressMockProvider(0);
            const longText = 'User: '.concat('a'.repeat(10000));

            const result = await makerReliableExtractMemory(longText, provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toBeDefined();
        });

        it('should handle extraction with many decisions and todos', async () => {
            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'Complex discussion with many action items and decision points across multiple architectural layers.',
                        decisions: Array(50).fill(null).map((_, i) => `Decision point ${i + 1}`),
                        todos: Array(100).fill(null).map((_, i) => `Action item ${i + 1}`)
                    });
                }
            };

            const result = await makerReliableExtractMemory('complex discussion', provider);

            expect(result).not.toBeNull();
            expect(result?.decisions.length).toBe(50);
            expect(result?.todos.length).toBe(100);
        });
    });

    describe('MAKER Stress Testing', () => {
        it('should handle concurrent extractions (50 in parallel)', async () => {
            const provider = new StressMockProvider(0);
            const promises: Promise<any>[] = [];

            const startTime = Date.now();

            // Launch 50 concurrent extractions
            for (let i = 0; i < 50; i++) {
                promises.push(
                    makerReliableExtractMemory(`Concurrent test ${i}`, provider)
                );
            }

            const results = await Promise.all(promises);
            const duration = Date.now() - startTime;

            // All should succeed
            expect(results.every(r => r !== null)).toBe(true);
            expect(provider.getCallCount()).toBe(150); // 50 × 3

            console.log(`[Stress Test] 50 concurrent extractions in ${duration}ms`);
        }, 30000);

        it('should handle 100% microagent failure rate gracefully', async () => {
            const provider = new StressMockProvider(1.0); // 100% failure

            const result = await makerReliableExtractMemory('test', provider);

            // Should return null when all fail
            expect(result).toBeNull();
            expect(provider.getCallCount()).toBe(3);
        });

        it('should handle 50% microagent failure rate', async () => {
            const provider = new StressMockProvider(0.5); // 50% failure rate
            const results: any[] = [];

            // Run 20 extractions to get statistical distribution
            for (let i = 0; i < 20; i++) {
                const result = await makerReliableExtractMemory(`test ${i}`, provider);
                results.push(result);
            }

            const successCount = results.filter(r => r !== null).length;
            const failureCount = results.filter(r => r === null).length;

            // With 50% failure rate, expect some successes and some failures
            expect(successCount).toBeGreaterThan(0);
            expect(failureCount).toBeGreaterThan(0);

            console.log(`[Stress Test] 50% failure rate: ${successCount} successes, ${failureCount} failures`);
        }, 15000);

        it('should maintain consensus quality under stress', async () => {
            let callCount = 0;
            const provider: MakerLLMProvider = {
                call: async () => {
                    callCount++;

                    // Return slightly different but overlapping responses
                    return JSON.stringify({
                        summary: `Stress test summary variant ${callCount % 3}`,
                        decisions: [
                            'Common decision',
                            callCount % 2 === 0 ? 'Decision A' : 'Decision B'
                        ],
                        todos: ['Common todo', `Todo ${callCount % 3}`]
                    });
                }
            };

            const results: any[] = [];

            // Run 10 extractions
            for (let i = 0; i < 10; i++) {
                const result = await makerReliableExtractMemory(`test ${i}`, provider);
                results.push(result);
            }

            // All should have the common decision (consensus)
            results.forEach(result => {
                expect(result?.decisions).toContain('Common decision');
            });
        });
    });

    describe('Edge Cases & Error Handling', () => {
        it('should handle empty input gracefully', async () => {
            const provider = new StressMockProvider(0);

            const result = await makerReliableExtractMemory('', provider);

            // Should still attempt extraction
            expect(result).not.toBeNull();
        });

        it('should handle input with only whitespace', async () => {
            const provider = new StressMockProvider(0);

            const result = await makerReliableExtractMemory('   \n\n\t  ', provider);

            expect(result).not.toBeNull();
        });

        it('should handle responses with extreme character counts', async () => {
            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'a'.repeat(1499), // Just under limit
                        decisions: ['Test decision'],
                        todos: []
                    });
                }
            };

            const result = await makerReliableExtractMemory('test', provider);

            expect(result).not.toBeNull();
            expect(result?.summary.length).toBe(1499);
        });

        it('should handle unicode edge cases', async () => {
            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: '测试中文字符 🎉🚀💾 émojis and special chars ñ ü ö',
                        decisions: ['决定使用 Unicode'],
                        todos: ['添加 emoji 支持 🎨']
                    });
                }
            };

            const result = await makerReliableExtractMemory('unicode test', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toContain('测试');
            expect(result?.summary).toContain('🎉');
        });

        it('should handle responses with nested quotes and escaping', async () => {
            const provider: MakerLLMProvider = {
                call: async () => {
                    return JSON.stringify({
                        summary: 'User said "Let\'s use the new API" and then asked about "edge cases".',
                        decisions: ['Decided to handle "quoted text" properly'],
                        todos: ['Test with strings like "this" and \'that\'']
                    });
                }
            };

            const result = await makerReliableExtractMemory('test', provider);

            expect(result).not.toBeNull();
            expect(result?.summary).toContain('"');
        });
    });

    describe('Performance Benchmarks', () => {
        it('should measure MAKER extraction latency distribution', async () => {
            const provider = new StressMockProvider(0);
            const latencies: number[] = [];

            // Run 100 extractions and measure latency
            for (let i = 0; i < 100; i++) {
                const start = Date.now();
                await makerReliableExtractMemory(`benchmark ${i}`, provider);
                latencies.push(Date.now() - start);
            }

            latencies.sort((a, b) => a - b);

            const p50 = latencies[Math.floor(latencies.length * 0.5)];
            const p95 = latencies[Math.floor(latencies.length * 0.95)];
            const p99 = latencies[Math.floor(latencies.length * 0.99)];
            const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

            console.log(`[Performance] Latency - p50: ${p50}ms, p95: ${p95}ms, p99: ${p99}ms, avg: ${avg.toFixed(2)}ms`);

            // Sanity checks (with mocks, should be fast)
            expect(p50).toBeLessThan(100);
            expect(p95).toBeLessThan(200);
            expect(p99).toBeLessThan(300);
        }, 60000);

        it('should measure consensus voting overhead', async () => {
            const provider = new StressMockProvider(0);
            const timings: { total: number }[] = [];

            for (let i = 0; i < 50; i++) {
                const start = Date.now();
                await makerReliableExtractMemory(`timing test ${i}`, provider);
                timings.push({ total: Date.now() - start });
            }

            const avgTotal = timings.reduce((sum, t) => sum + t.total, 0) / timings.length;

            console.log(`[Performance] Average total time per extraction: ${avgTotal.toFixed(2)}ms`);

            expect(avgTotal).toBeLessThan(100); // With mocks
        });

        it('should handle rapid sequential extractions without degradation', async () => {
            const provider = new StressMockProvider(0);
            const batchSize = 20;
            const batches = 5;
            const batchTimings: number[] = [];

            for (let batch = 0; batch < batches; batch++) {
                const start = Date.now();

                for (let i = 0; i < batchSize; i++) {
                    await makerReliableExtractMemory(`batch ${batch} item ${i}`, provider);
                }

                batchTimings.push(Date.now() - start);
            }

            // Performance should not degrade significantly across batches
            const firstBatch = batchTimings[0];
            const lastBatch = batchTimings[batches - 1];
            const degradation = (lastBatch - firstBatch) / firstBatch;

            console.log(`[Performance] Batch timings:`, batchTimings);
            console.log(`[Performance] Degradation: ${(degradation * 100).toFixed(2)}%`);

            // Allow up to 50% degradation (memory pressure, GC, etc.)
            expect(Math.abs(degradation)).toBeLessThan(0.5);
        }, 30000);
    });
});
