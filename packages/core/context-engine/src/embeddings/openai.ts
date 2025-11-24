/**
 * OpenAI embedding provider implementation
 */

import OpenAI from 'openai';
import type { EmbeddingProvider } from './base.js';

/**
 * Configuration for OpenAI embedding provider
 */
export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model?: string;
  organization?: string;
  baseURL?: string;
}

/**
 * Model dimensions mapping
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * OpenAI embedding provider using OpenAI's embeddings API
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private _model: string;
  private _dimensions: number;

  constructor(config: OpenAIEmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      baseURL: config.baseURL,
    });

    this._model = config.model || 'text-embedding-3-small';
    
    // Get dimensions for the model
    this._dimensions = MODEL_DIMENSIONS[this._model];
    if (!this._dimensions) {
      throw new Error(`Unknown model: ${this._model}. Supported models: ${Object.keys(MODEL_DIMENSIONS).join(', ')}`);
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this._model,
        input: text,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding returned from OpenAI API');
      }

      const embedding = response.data[0].embedding;
      
      // Validate embedding
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding format returned from OpenAI API');
      }
      
      // Validate embedding dimensions
      if (embedding.length !== this._dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this._dimensions}, got ${embedding.length}`
        );
      }
      
      // Validate all values are finite numbers
      if (embedding.some(v => !Number.isFinite(v))) {
        throw new Error('Embedding contains invalid values (NaN or Infinity)');
      }

      return embedding;
    } catch (error) {
      if (error instanceof Error) {
        // Don't wrap already wrapped errors
        if (error.message.startsWith('Failed to generate embedding:')) {
          throw error;
        }
        throw new Error(`Failed to generate embedding: ${error.message}`);
      }
      throw new Error('Failed to generate embedding: Unknown error');
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    // Validate all texts are non-empty
    const emptyIndex = texts.findIndex(t => !t || t.trim().length === 0);
    if (emptyIndex !== -1) {
      throw new Error(`Text at index ${emptyIndex} is empty`);
    }

    try {
      const response = await this.client.embeddings.create({
        model: this._model,
        input: texts,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, got ${response.data?.length || 0}`);
      }

      // Sort by index to ensure correct order
      const sortedData = response.data.sort((a, b) => a.index - b.index);
      const embeddings = sortedData.map(item => item.embedding);
      
      // Validate all embeddings
      for (let i = 0; i < embeddings.length; i++) {
        const embedding = embeddings[i];
        
        if (!Array.isArray(embedding) || embedding.length === 0) {
          throw new Error(`Invalid embedding format at index ${i}`);
        }
        
        if (embedding.length !== this._dimensions) {
          throw new Error(
            `Embedding dimension mismatch at index ${i}: expected ${this._dimensions}, got ${embedding.length}`
          );
        }
        
        if (embedding.some(v => !Number.isFinite(v))) {
          throw new Error(`Embedding at index ${i} contains invalid values (NaN or Infinity)`);
        }
      }
      
      return embeddings;
    } catch (error) {
      if (error instanceof Error) {
        // Don't wrap already wrapped errors
        if (error.message.startsWith('Failed to generate batch embeddings:')) {
          throw error;
        }
        throw new Error(`Failed to generate batch embeddings: ${error.message}`);
      }
      throw new Error('Failed to generate batch embeddings: Unknown error');
    }
  }

  /**
   * Get embedding dimensions for this provider
   */
  get dimensions(): number {
    return this._dimensions;
  }

  /**
   * Get model name
   */
  get model(): string {
    return this._model;
  }
}
