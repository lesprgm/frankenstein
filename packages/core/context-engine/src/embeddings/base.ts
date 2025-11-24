/**
 * Base embedding provider interface and types
 */

/**
 * Embedding provider interface for generating vector embeddings from text
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding for a single text
   * @param text - Text to embed
   * @returns Promise resolving to embedding vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts - Array of texts to embed
   * @returns Promise resolving to array of embedding vectors
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Embedding dimensions for this provider
   */
  readonly dimensions: number;

  /**
   * Model name/identifier
   */
  readonly model: string;
}
