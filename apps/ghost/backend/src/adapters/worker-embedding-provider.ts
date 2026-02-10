import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { EMBEDDING_MODELS, EmbeddingModelKey, LocalEmbeddingProvider } from './local-embedding-provider';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerMessage {
    id: string;
    result?: number[] | number[][];
    error?: string;
    type?: string;
}

export class WorkerEmbeddingProvider {
    private worker: Worker | null = null;
    private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private initPromise: Promise<void> | null = null;
    private fallbackProvider: LocalEmbeddingProvider | null = null;
    private workerFailed = false;
    
    private readonly modelKey: EmbeddingModelKey;
    public readonly model: string;
    public readonly dimensions: number;
    public readonly cacheDir: string;

    constructor(config: {
        model?: EmbeddingModelKey;
        cacheDir?: string;
    } = {}) {
        const modelKey = config.model || 'all-MiniLM-L6-v2';
        const modelInfo = EMBEDDING_MODELS[modelKey];
        this.modelKey = modelKey;
        
        this.model = modelInfo.name;
        this.dimensions = modelInfo.dimensions;
        this.cacheDir = config.cacheDir || join(process.cwd(), 'data', 'models');
    }

    private getWorkerPath(): string {
        // Handle both .ts (dev/tsx) and .js (prod/node)
        const ext = extname(__filename);
        if (ext === '.ts') {
            return join(__dirname, '../workers/embedding.worker.ts');
        }
        return join(__dirname, '../workers/embedding.worker.js');
    }

    private async ensureWorker() {
        if (this.workerFailed) {
            throw new Error('Embedding worker unavailable; falling back to local embeddings');
        }
        if (this.worker) return;

        if (!this.initPromise) {
            this.initPromise = new Promise((resolve, reject) => {
                let settled = false;
                let initTimeout: NodeJS.Timeout | null = null;
                const safeResolve = () => {
                    if (settled) return;
                    settled = true;
                    if (initTimeout) clearTimeout(initTimeout);
                    resolve();
                };
                const safeReject = (err: Error) => {
                    if (settled) return;
                    settled = true;
                    if (initTimeout) clearTimeout(initTimeout);
                    this.workerFailed = true;
                    this.worker = null;
                    this.initPromise = null;
                    reject(err);
                };
                initTimeout = setTimeout(() => {
                    safeReject(new Error('Embedding worker initialization timed out'));
                }, 10000);

                const workerPath = this.getWorkerPath();
                console.log(`[Embedding] Spawning worker: ${workerPath}`);

                // Check if we are running in a TS environment (like tsx or ts-node)
                // If so, we might need to register the loader for the worker
                const workerOptions: any = {
                    workerData: { cacheDir: this.cacheDir }
                };

                // Simple heuristic: if we are running a .ts file, try to use the same execArgv
                // This helps tsx/ts-node propagate to the worker
                if (workerPath.endsWith('.ts')) {
                     // This is often enough for tsx/ts-node to handle the worker
                     // But explicit registration might be needed depending on the runner
                }

                this.worker = new Worker(workerPath, workerOptions);

                this.worker.on('message', (msg: WorkerMessage) => {
                    if (msg.type === 'ready') {
                        console.log('[Embedding] Worker ready');
                        safeResolve();
                        return;
                    }
                    
                    if (msg.type === 'error') {
                        const message = msg.error || 'Unknown worker initialization error';
                        console.error('[Embedding] Worker init error:', message);
                        safeReject(new Error(`Embedding worker failed to initialize: ${message}`));
                        return;
                    }

                    const pending = this.pendingRequests.get(msg.id);
                    if (pending) {
                        this.pendingRequests.delete(msg.id);
                        if (msg.error) pending.reject(new Error(msg.error));
                        else pending.resolve(msg.result);
                    }
                });

                this.worker.on('error', (err) => {
                    console.error('[Embedding] Worker crashed:', err);
                    this.worker = null;
                    this.initPromise = null;
                    this.workerFailed = true;
                    // Reject all pending
                    for (const [_, req] of this.pendingRequests) {
                        req.reject(err);
                    }
                    this.pendingRequests.clear();
                    safeReject(err instanceof Error ? err : new Error('Embedding worker crashed'));
                });

                // Send init message
                this.worker.postMessage({ type: 'init', model: this.model });
            });
        }

        await this.initPromise;
    }

    private async getFallbackProvider(): Promise<LocalEmbeddingProvider> {
        if (!this.fallbackProvider) {
            this.fallbackProvider = new LocalEmbeddingProvider({
                model: this.modelKey,
                cacheDir: this.cacheDir,
            });
        }
        return this.fallbackProvider;
    }

    async embed(text: string): Promise<number[]> {
        try {
            await this.ensureWorker();
            const id = Math.random().toString(36).substring(7);
            
            return await new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
                this.worker!.postMessage({ id, type: 'embed', text });
            });
        } catch (error) {
            console.warn('[Embedding] Worker unavailable, using local embeddings fallback.');
            try {
                const fallback = await this.getFallbackProvider();
                return await fallback.embed(text);
            } catch (fallbackError) {
                const primary = error instanceof Error ? error.message : String(error);
                const secondary = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                throw new Error(`Embedding failed: worker error (${primary}); fallback error (${secondary})`);
            }
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        try {
            await this.ensureWorker();
            const id = Math.random().toString(36).substring(7);

            return await new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
                this.worker!.postMessage({ id, type: 'embedBatch', texts });
            });
        } catch (error) {
            console.warn('[Embedding] Worker unavailable, using local embeddings fallback.');
            try {
                const fallback = await this.getFallbackProvider();
                return await fallback.embedBatch(texts);
            } catch (fallbackError) {
                const primary = error instanceof Error ? error.message : String(error);
                const secondary = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                throw new Error(`Embedding batch failed: worker error (${primary}); fallback error (${secondary})`);
            }
        }
    }

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

export const workerEmbeddingProvider = new WorkerEmbeddingProvider();
