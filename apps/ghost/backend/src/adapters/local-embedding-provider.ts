// Optional dependency for local embeddings - requires @xenova/transformers
// Lazy load transformers if available
let pipelineLoader: any = null;
let envConfig: any = null;

async function loadTransformers() {
    if (!pipelineLoader) {
        try {
            const transformers = await import('@xenova/transformers' as any);
            pipelineLoader = transformers.pipeline;
            envConfig = transformers.env;
        } catch (error) {
            throw new Error('@xenova/transformers not installed. Run: npm install @xenova/transformers');
        }
    }
    return { pipeline: pipelineLoader, env: envConfig };
}

/**
 * Supported embedding models with their dimensions
 */
export const EMBEDDING_MODELS = {
    // Fast, lightweight model - good for general use (recommended)
    'all-MiniLM-L6-v2': {
        name: 'Xenova/all-MiniLM-L6-v2',
        dimensions: 384,
        size: '~80MB',
        description: 'Small, fast model for general-purpose embeddings',
    },
    // Larger, more accurate model
    'all-mpnet-base-v2': {
        name: 'Xenova/all-mpnet-base-v2',
        dimensions: 768,
        size: '~420MB',
        description: 'Larger, more accurate model for better semantic understanding',
    },
    // Multilingual model
    'paraphrase-multilingual-MiniLM-L12-v2': {
        name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        dimensions: 384,
        size: '~220MB',
        description: 'Supports 50+ languages',
    },
} as const;

export type EmbeddingModelKey = keyof typeof EMBEDDING_MODELS;

/**
 * Configuration for LocalEmbeddingProvider
 */
export interface LocalEmbeddingConfig {
    /**
     * Model to use for embeddings
     * @default 'all-MiniLM-L6-v2'
     */
    model?: EmbeddingModelKey;

    /**
     * Directory to cache downloaded models
     * @default './models' or EMBEDDING_CACHE_DIR env var
     */
    cacheDir?: string;

    /**
     * Whether to allow loading models from local filesystem
     * @default true
     */
    allowLocalModels?: boolean;

    /**
     * Batch size for bulk embedding operations
     * @default 32
     */
    batchSize?: number;
}

/**
 * Local embedding provider using Transformers.js
 * Implements MemoryLayer's EmbeddingProvider interface
 * Privacy: All embeddings generated locally, no API calls
 */
export class LocalEmbeddingProvider {
    public readonly model: string;
    public readonly dimensions: number;
    public readonly modelInfo: typeof EMBEDDING_MODELS[EmbeddingModelKey];
    private readonly cacheDir: string;
    private readonly batchSize: number;
    private embedder: any = null;
    private initPromise: Promise<void> | null = null;

    constructor(config: LocalEmbeddingConfig = {}) {
        const modelKey = config.model || 'all-MiniLM-L6-v2';
        this.modelInfo = EMBEDDING_MODELS[modelKey];
        this.model = this.modelInfo.name;
        this.dimensions = this.modelInfo.dimensions;
        this.cacheDir = config.cacheDir || process.env.EMBEDDING_CACHE_DIR || './models';
        this.batchSize = config.batchSize || 32;

        console.log(`LocalEmbeddingProvider configured with model: ${modelKey}`);
        console.log(`  - Dimensions: ${this.dimensions}`);
        console.log(`  - Size: ${this.modelInfo.size}`);
        console.log(`  - Cache: ${this.cacheDir}`);
    }

    /**
     * Initialize the embedding model
     * Downloads model on first run (~80MB), then caches locally
     */
    private async initialize(): Promise<void> {
        if (this.embedder) return;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                console.log(`Initializing ${this.model}...`);
                console.log(`This may take a few minutes on first run (downloading ${this.modelInfo.size})`);

                const { pipeline: pipelineFn, env: envConfig } = await loadTransformers();

                if (!envConfig || !pipelineFn) {
                    throw new Error('Failed to load transformers');
                }

                // Configure cache using instance settings
                envConfig.cacheDir = this.cacheDir;
                envConfig.allowLocalModels = true;

                // Optionally disable remote models to enforce local-only
                // envConfig.allowRemoteModels = false;

                this.embedder = await pipelineFn('feature-extraction', this.model);
                console.log('✓ Local embedding model ready');
            })();
        }

        await this.initPromise;
    }

    /**
     * Generate embedding for text
     * @param text - Text to embed
     * @returns 384-dimensional embedding vector
     */
    async embed(text: string): Promise<number[]> {
        await this.initialize();

        // Generate embedding
        const output = await this.embedder(text, {
            pooling: 'mean',
            normalize: true,
        });

        // Convert to array
        const embedding = Array.from(output.data) as number[];

        // Validate dimensions
        if (embedding.length !== this.dimensions) {
            throw new Error(
                `Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
            );
        }

        return embedding;
    }

    /**
     * Generate embeddings for multiple texts (batch)
     * @param texts - Array of texts to embed
     * @returns Array of embedding vectors
     */
    async embedBatch(texts: string[]): Promise<number[][]> {
        await this.initialize();

        const embeddings: number[][] = [];

        // Process in batches to avoid memory issues
        for (let i = 0; i < texts.length; i += this.batchSize) {
            const batch = texts.slice(i, i + this.batchSize);
            const batchEmbeddings = await Promise.all(
                batch.map(text => this.embed(text))
            );
            embeddings.push(...batchEmbeddings);

            // Log progress for large batches
            if (texts.length > this.batchSize) {
                console.log(`Embedded ${Math.min(i + this.batchSize, texts.length)}/${texts.length} texts`);
            }
        }

        return embeddings;
    }
}

// Export singleton instance with default configuration
export const localEmbeddingProvider = new LocalEmbeddingProvider();
