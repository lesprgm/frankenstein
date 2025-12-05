/**
 * @memorylayer/core - Simple wrapper for MemoryLayer
 * 
 * Get started in 5 lines:
 * ```typescript
 * const ml = new MemoryLayer({ storage: 'sqlite://memory.db', apiKey: '...' });
 * await ml.extract("Project Alpha deadline is Q4");
 * const results = await ml.search("when is the deadline?");
 * ```
 */

import { StorageClient, type StorageConfig } from '@memorylayer/storage';
import {
    MemoryExtractor,
    OpenAIProvider,
    StructuredOutputStrategy,
    type NormalizedConversation
} from '@memorylayer/memory-extraction';
import {
    ContextEngine,
    OpenAIEmbeddingProvider
} from '@memorylayer/context-engine';

export interface MemoryLayerConfig {
    /** Storage URL (e.g., 'sqlite://memory.db' or full config) */
    storage: string | StorageConfig;

    /** OpenAI API key for extraction and embeddings */
    apiKey?: string;

    /** Memory types to extract (defaults to ['entity', 'fact', 'decision']) */
    memoryTypes?: string[];

    /** Minimum confidence threshold (0-1) */
    minConfidence?: number;
}

export interface SearchOptions {
    /** Maximum number of results */
    limit?: number;

    /** Filter by memory types */
    types?: string[];

    /** Include relationship traversal */
    includeRelationships?: boolean;

    /** Token budget for context */
    tokenBudget?: number;
}

/**
 * MemoryLayer - Simple API for persistent AI memory
 */
export class MemoryLayer {
    private storage: StorageClient;
    private extractor: MemoryExtractor | null;
    private context: ContextEngine | null;
    private workspaceId: string;

    constructor(config: MemoryLayerConfig) {
        // Parse storage config
        let storageConfig: StorageConfig;
        if (typeof config.storage === 'string') {
            // Simple string format: 'sqlite://path' or 'postgres://url'
            if (config.storage.startsWith('sqlite://')) {
                const filename = config.storage.replace('sqlite://', '');
                storageConfig = {
                    sqlite: { filename },
                    vectorize: { mode: 'local' },
                };
            } else if (config.storage.startsWith('postgres://')) {
                throw new Error('Postgres string format not yet supported. Use full config.');
            } else {
                throw new Error('Invalid storage format. Use "sqlite://path" or provide full config.');
            }
        } else {
            storageConfig = config.storage;
        }

        // Initialize storage
        this.storage = new StorageClient(storageConfig);

        // Initialize extractor (if API key provided)
        if (config.apiKey) {
            const provider = new OpenAIProvider({
                apiKey: config.apiKey,
                defaultModel: 'gpt-4o' // Default to high-quality model for extraction
            });

            this.extractor = new MemoryExtractor({
                provider,
                strategy: new StructuredOutputStrategy(),
                memoryTypes: config.memoryTypes ?? ['entity', 'fact', 'decision'],
                minConfidence: config.minConfidence ?? 0.7
            });
        } else {
            this.extractor = null;
        }

        // Initialize context engine
        if (config.apiKey) {
            const embeddingProvider = new OpenAIEmbeddingProvider({
                apiKey: config.apiKey,
                model: 'text-embedding-3-small'
            });

            this.context = new ContextEngine({
                storageClient: this.storage,
                embeddingProvider,
                defaultTemplate: 'chat'
            });
        } else {
            this.context = null;
        }

        // Create default workspace
        this.workspaceId = 'default';
        this.ensureWorkspace().catch(err => console.error('Failed to init workspace:', err));
    }

    private async ensureWorkspace() {
        const existing = await this.storage.getWorkspace(this.workspaceId);
        if (!existing.ok || !existing.value) {
            await this.storage.createWorkspace({
                id: this.workspaceId,
                name: 'Default Workspace',
                owner_id: 'default_user',
                type: 'personal' // Assuming 'personal' is a valid type
            });
        }
    }

    /**
     * Extract memories from text
     */
    async extract(text: string, options?: { types?: string[] }): Promise<void> {
        if (!this.extractor) {
            throw new Error('API key required for extraction. Provide apiKey in config.');
        }

        // Convert text to a normalized conversation
        const conversation: NormalizedConversation = {
            id: `conv_${Date.now()}`,
            messages: [
                {
                    id: `msg_${Date.now()}`,
                    role: 'user',
                    content: text,
                    timestamp: new Date().toISOString()
                }
            ],
            metadata: {}
        };

        const result = await this.extractor.extract(conversation, this.workspaceId, {
            memoryTypes: options?.types
        });

        if (!result.ok) {
            // Handle ExtractionError union type
            const errorMsg = (result.error as any).message || 'Unknown extraction error';
            throw new Error(`Extraction failed: ${errorMsg}`);
        }

        const { memories, relationships } = result.value;

        // Batch create memories
        if (memories.length > 0) {
            for (const memory of memories) {
                // Cast to any because partial memory is returned by extractor but storage expects simple input
                await this.storage.createMemory(memory as any);
            }
        }

        // Batch create relationships
        if (relationships.length > 0) {
            for (const rel of relationships) {
                await this.storage.createRelationship(rel as any);
            }
        }
    }

    /**
     * Search for relevant memories
     */
    async search(query: string, options?: SearchOptions): Promise<any[]> {
        if (!this.context) {
            throw new Error('Context engine not initialized (requires apiKey)');
        }

        const result = await this.context.search(query, this.workspaceId, {
            limit: options?.limit ?? 10,
            memoryTypes: options?.types,
            includeRelationships: options?.includeRelationships,
        });

        if (!result.ok) {
            throw new Error(`Search failed: ${result.error.message}`);
        }

        return result.value;
    }

    /**
     * Build context for a query
     */
    async buildContext(query: string, options?: SearchOptions): Promise<string> {
        if (!this.context) {
            throw new Error('Context engine not initialized (requires apiKey)');
        }

        const result = await this.context.buildContext(query, this.workspaceId, {
            tokenBudget: options?.tokenBudget ?? 2000,
            includeRelationships: options?.includeRelationships,
            limit: options?.limit
        });

        if (!result.ok) {
            throw new Error(`Context building failed: ${result.error.message}`);
        }

        // Access the 'context' property
        return (result.value as any).context;
    }

    /**
     * Get direct access to storage client (advanced usage)
     */
    getStorage(): StorageClient {
        return this.storage;
    }

    /**
     * Get direct access to extractor (advanced usage)
     */
    getExtractor(): MemoryExtractor | null {
        return this.extractor;
    }

    /**
     * Get direct access to context engine (advanced usage)
     */
    getContextEngine(): ContextEngine | null {
        return this.context;
    }
}

// Re-export types from underlying packages
export type { StorageConfig } from '@memorylayer/storage';
export type { Memory, Workspace, Conversation } from '@memorylayer/storage';
