import { MemoryExtractor } from '@memorylayer/memory-extraction';
import { ContextEngine } from '@memorylayer/context-engine';
import { ChatCapture } from '@memorylayer/chat-capture';
import { LocalStorageClient } from '../adapters/local-storage-client.js';
import { LocalEmbeddingProvider } from '../adapters/local-embedding-provider.js';
import { SingleUserManager } from '../adapters/single-user-manager.js';
import { initializeDatabase } from '../db/migrations.js';

/**
 * Lightweight OpenRouter provider adapter for MemoryExtractor.
 * Expects OPENROUTER_API_KEY and OPENROUTER_MODEL in env.
 */
class OpenRouterProvider {
    private apiKey: string;
    private model: string;
    private timeout: number;

    constructor(opts: { apiKey: string; model: string; timeout?: number }) {
        this.apiKey = opts.apiKey;
        this.model = opts.model;
        this.timeout = opts.timeout ?? 60000;
    }

    async call(prompt: string, _options?: { temperature?: number; timeout?: number }): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`OpenRouter error ${res.status}: ${text || res.statusText}`);
            }

            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (!content) throw new Error('OpenRouter response missing content');
            return content;
        } finally {
            clearTimeout(timer);
        }
    }

    async completeStructured(prompt: string, schema: any, _options?: { temperature?: number; timeout?: number }): Promise<any> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: `Return JSON ONLY that matches this schema: ${JSON.stringify(schema)}.` },
                        { role: 'user', content: prompt },
                    ],
                    stream: false,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`OpenRouter structured error ${res.status}: ${text || res.statusText}`);
            }

            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (!content) throw new Error('OpenRouter response missing content');
            try {
                return JSON.parse(content);
            } catch {
                throw new Error('OpenRouter structured response was not valid JSON');
            }
        } finally {
            clearTimeout(timer);
        }
    }
}

/**
 * Multi-provider round robin with simple fallback.
 */
class MultiProvider {
    private providers: Array<{
        call: (prompt: string, options?: { temperature?: number; timeout?: number }) => Promise<string>;
        completeStructured?: (prompt: string, schema: any, options?: { temperature?: number; timeout?: number }) => Promise<any>;
    }>;
    private idx = 0;

    constructor(providers: Array<{
        call: (prompt: string, options?: { temperature?: number; timeout?: number }) => Promise<string>;
        completeStructured?: (prompt: string, schema: any, options?: { temperature?: number; timeout?: number }) => Promise<any>;
    }>) {
        this.providers = providers.filter(Boolean);
        if (this.providers.length === 0) {
            throw new Error('No providers configured for MultiProvider');
        }
    }

    async call(prompt: string, options?: { temperature?: number; timeout?: number }): Promise<string> {
        let lastError: any = null;
        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[(this.idx + i) % this.providers.length];
            try {
                const result = await provider.call(prompt, options);
                // advance round robin pointer
                this.idx = (this.idx + i + 1) % this.providers.length;
                return result;
            } catch (err) {
                lastError = err;
                continue;
            }
        }
        throw lastError || new Error('All providers failed');
    }

    async completeStructured(prompt: string, schema: any, options?: { temperature?: number; timeout?: number }): Promise<any> {
        let lastError: any = null;
        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[(this.idx + i) % this.providers.length];
            if (!provider.completeStructured) continue;
            try {
                const result = await provider.completeStructured(prompt, schema, options);
                this.idx = (this.idx + i + 1) % this.providers.length;
                return result;
            } catch (err) {
                lastError = err;
                continue;
            }
        }
        throw lastError || new Error('All providers failed (structured)');
    }
}

/**
 * MemoryLayer Integration Service
 * Initializes and manages MemoryLayer components with local adapters
 * Privacy: Balanced mode - local storage + local embeddings + Gemini API
 */
export class MemoryLayerIntegration {
    public storageClient: LocalStorageClient;
    public embeddingProvider: LocalEmbeddingProvider;
    public singleUserManager: SingleUserManager;
    public memoryExtractor: MemoryExtractor | null = null;
    public contextEngine: ContextEngine | null = null;
    public chatCapture: ChatCapture | null = null;

    private initialized: boolean = false;

    constructor(dbPath: string = './ghost.db', externalStorageClient?: any) {
        // Initialize database
        const db = initializeDatabase(dbPath);

        // Use external storageClient if provided (for integration with SQLiteStorage)
        // Otherwise create local adapters
        if (externalStorageClient) {
            this.storageClient = externalStorageClient;
        } else {
            this.storageClient = new LocalStorageClient(db);
        }
        this.embeddingProvider = new LocalEmbeddingProvider();
        this.singleUserManager = new SingleUserManager(db);
    }

    /**
     * Initialize MemoryLayer components
     * Must be called before using any MemoryLayer features
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('Initializing MemoryLayer integration...');

        // Initialize single-user workspace
        await this.singleUserManager.initialize();

        // Initialize ContextEngine with local adapters
        this.contextEngine = new ContextEngine({
            storageClient: this.storageClient as any, // Type compatibility
            embeddingProvider: this.embeddingProvider as any, // Type compatibility
            defaultTemplate: 'chat',
            defaultTokenBudget: 2000,
            logger: {
                info: (msg: string, ctx?: any) => console.log(`[ContextEngine] ${msg}`, ctx),
                warn: (msg: string, ctx?: any) => console.warn(`[ContextEngine] ${msg}`, ctx),
                error: (msg: string, ctx?: any) => console.error(`[ContextEngine] ${msg}`, ctx),
                debug: (msg: string, ctx?: any) => console.debug(`[ContextEngine] ${msg}`, ctx),
            },
        });

        // Register concise template for Ghost
        this.contextEngine.registerTemplate('concise', {
            name: 'concise',
            header: 'Context:',
            memoryFormat: '- {{summary}}',
            separator: '\n',
            includeMetadata: false,
        });

        // Initialize ChatCapture
        this.chatCapture = new ChatCapture({
            logger: {
                info: (msg: string, ctx?: any) => console.log(`[ChatCapture] ${msg}`, ctx),
                warn: (msg: string, ctx?: any) => console.warn(`[ChatCapture] ${msg}`, ctx),
                error: (msg: string, ctx?: any) => console.error(`[ChatCapture] ${msg}`, ctx),
                debug: (msg: string, ctx?: any) => console.debug(`[ChatCapture] ${msg}`, ctx),
            },
        });

        // Initialize MemoryExtractor with chunking enabled for file ingestion
        if (!this.memoryExtractor) {
            const providerName = (process.env.MEMORY_PROVIDER || 'gemini').toLowerCase();
            const { StructuredOutputStrategy } = await import('@memorylayer/memory-extraction');
            let provider: any = null;

            const canUseOpenRouter = !!process.env.OPENROUTER_API_KEY && !!process.env.OPENROUTER_MODEL;
            const canUseGemini = !!process.env.GEMINI_API_KEY;
            const useHybrid = providerName === 'hybrid' || providerName === 'multi';
            const openRouterTimeout = parseInt(process.env.OPENROUTER_TIMEOUT_MS || '10000', 10); // default 10s; override via env

            if (useHybrid && (canUseOpenRouter && canUseGemini)) {
                const { GeminiProvider } = await import('@memorylayer/memory-extraction');
                const geminiProvider = new GeminiProvider({
                    apiKey: process.env.GEMINI_API_KEY as string,
                    timeout: 60000,
                });
                const openRouterProvider = new OpenRouterProvider({
                    apiKey: process.env.OPENROUTER_API_KEY as string,
                    model: process.env.OPENROUTER_MODEL as string,
                    timeout: openRouterTimeout,
                });
                provider = new MultiProvider([openRouterProvider, geminiProvider]);
                console.info('[MemoryLayer] Using hybrid provider (OpenRouter + Gemini) for extraction');
            }

            if (!provider && providerName === 'openrouter') {
                const apiKey = process.env.OPENROUTER_API_KEY;
                const model = process.env.OPENROUTER_MODEL;
                if (apiKey && model) {
                    provider = new OpenRouterProvider({ apiKey, model, timeout: openRouterTimeout });
                    console.info('[MemoryLayer] Using OpenRouter provider for extraction', { model, timeoutMs: openRouterTimeout });
                }
            }

            if (!provider) {
                const geminiApiKey = process.env.GEMINI_API_KEY;
                if (!geminiApiKey) {
                    console.warn('[MemoryLayer] GEMINI_API_KEY not set - MemoryExtractor will not be available');
                    this.initialized = true;
                    return;
                }
                const { GeminiProvider } = await import('@memorylayer/memory-extraction');
                provider = new GeminiProvider({
                    apiKey: geminiApiKey,
                    timeout: 60000,  // 60 seconds for file extraction (can be slow for large files)
                });
            }

            const strategy = new StructuredOutputStrategy();

            this.memoryExtractor = new (await import('@memorylayer/memory-extraction')).MemoryExtractor({
                provider,
                strategy,
                memoryTypes: ['entity', 'fact'],
                minConfidence: 0.7,
                chunking: {
                    enabled: true,
                    maxTokensPerChunk: 32000,  // ~24k words, good for document sections
                    strategy: 'semantic',  // Split by topic for documents
                    overlapPercentage: 0.1,  // 10% overlap
                    failureMode: 'continue-on-error',
                },
                logger: {
                    info: (msg: string, ctx?: any) => console.log(`[MemoryExtractor] ${msg}`, ctx),
                    warn: (msg: string, ctx?: any) => console.warn(`[MemoryExtractor] ${msg}`, ctx),
                    error: (msg: string, ctx?: any) => console.error(`[MemoryExtractor] ${msg}`, ctx),
                    debug: (msg: string, ctx?: any) => console.debug(`[MemoryExtractor] ${msg}`, ctx),
                },
            });

            console.log('[MemoryLayer] MemoryExtractor initialized with chunking enabled');
        }

        this.initialized = true;
        console.log('MemoryLayer integration initialized successfully');
    }

    /**
     * Get default workspace ID
     */
    getWorkspaceId(): string {
        return this.singleUserManager.getWorkspaceId();
    }

    /**
     * Get default user ID
     */
    getUserId(): string {
        return this.singleUserManager.getUserId();
    }

    /**
     * Check if MemoryLayer is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }
}

// Export singleton instance
const DATABASE_PATH = process.env.DATABASE_PATH || './ghost.db';
export const memoryLayerIntegration = new MemoryLayerIntegration(DATABASE_PATH);
