import OpenAI from 'openai'

/**
 * Service for generating embeddings using OpenAI
 */
export class EmbeddingService {
    private openai: OpenAI
    private model: string

    constructor(apiKey: string, model: string = 'text-embedding-3-small') {
        this.openai = new OpenAI({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL
        })
        this.model = model
    }

    /**
     * Generate embedding for a single text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        if (!text || text.trim().length === 0) {
            throw new Error('Text cannot be empty')
        }

        try {
            const response = await this.openai.embeddings.create({
                model: this.model,
                input: text,
                encoding_format: 'float'
            })

            return response.data[0].embedding
        } catch (error) {
            console.error('Failed to generate embedding:', error)
            throw new Error('Embedding generation failed')
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     */
    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) {
            return []
        }

        // Filter out empty texts
        const validTexts = texts.filter(t => t && t.trim().length > 0)
        if (validTexts.length === 0) {
            throw new Error('No valid texts to embed')
        }

        try {
            const response = await this.openai.embeddings.create({
                model: this.model,
                input: validTexts,
                encoding_format: 'float'
            })

            return response.data.map(item => item.embedding)
        } catch (error) {
            console.error('Failed to generate embeddings:', error)
            throw new Error('Batch embedding generation failed')
        }
    }

    /**
     * Get the dimension of embeddings for this model
     */
    getDimensions(): number {
        // text-embedding-3-small produces 1536-dimensional vectors
        // text-embedding-3-large produces 3072-dimensional vectors
        return this.model.includes('large') ? 3072 : 1536
    }
}
