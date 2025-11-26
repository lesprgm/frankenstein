/**
 * VectorizeAdapter - Cloudflare Vectorize operations wrapper
 */

import { Result, StorageError } from './errors';
import { MemoryType } from './models';

/**
 * Configuration for Vectorize client
 */
export interface VectorizeConfig {
  accountId?: string;
  apiToken?: string;
  indexName?: string;
  mode?: 'cloud' | 'local';
}

/**
 * Metadata stored with each vector
 */
export interface VectorMetadata {
  workspace_id: string;
  type: MemoryType;
  [key: string]: any;
}

/**
 * Result from vector search
 */
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

/**
 * Filter options for vector search
 */
export interface VectorSearchFilter {
  workspace_id: string;
  types?: MemoryType[];
  dateFrom?: Date;
  dateTo?: Date;
}

// ...

export class VectorizeAdapter {
  private config: VectorizeConfig;
  private baseUrl: string;

  constructor(config: VectorizeConfig) {
    this.config = config;
    // Default to local if no accountId provided
    if (!config.accountId || config.mode === 'local') {
      this.config.mode = 'local';
      this.baseUrl = '';
    } else {
      this.config.mode = 'cloud';
      this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/indexes/${config.indexName}`;
    }
  }

  /**
   * Upsert a vector with metadata
   */
  async upsert(
    id: string,
    vector: number[],
    metadata: VectorMetadata
  ): Promise<Result<void, StorageError>> {
    if (this.config.mode === 'local') {
      return { ok: true, value: undefined };
    }
    try {
      const response = await fetch(`${this.baseUrl}/upsert`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: [
            {
              id,
              values: vector,
              metadata,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: {
            type: 'vector_store',
            message: `Failed to upsert vector: ${response.statusText}`,
            cause: errorData,
          },
        };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'vector_store',
          message: 'Failed to upsert vector',
          cause: error,
        },
      };
    }
  }

  /**
   * Search for vectors by similarity with metadata filters
   */
  async search(
    vector: number[],
    limit: number,
    filter?: VectorSearchFilter
  ): Promise<Result<VectorSearchResult[], StorageError>> {
    if (this.config.mode === 'local') {
      return { ok: true, value: [] };
    }
    try {
      // Build metadata filter for Vectorize
      const metadataFilter: Record<string, any> = {};

      if (filter) {
        // Workspace filter is required
        metadataFilter.workspace_id = filter.workspace_id;

        // Optional type filter
        if (filter.types && filter.types.length > 0) {
          metadataFilter.type = { $in: filter.types };
        }

        // Date range filters (if supported by metadata)
        if (filter.dateFrom) {
          metadataFilter.created_at = metadataFilter.created_at || {};
          metadataFilter.created_at.$gte = filter.dateFrom.toISOString();
        }
        if (filter.dateTo) {
          metadataFilter.created_at = metadataFilter.created_at || {};
          metadataFilter.created_at.$lte = filter.dateTo.toISOString();
        }
      }

      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vector,
          topK: limit,
          filter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
          returnMetadata: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: {
            type: 'vector_store',
            message: `Failed to search vectors: ${response.statusText}`,
            cause: errorData,
          },
        };
      }

      const data: any = await response.json();
      const results: VectorSearchResult[] = (data.result?.matches || []).map((match: any) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata || {},
      }));

      return { ok: true, value: results };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'vector_store',
          message: 'Failed to search vectors',
          cause: error,
        },
      };
    }
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<Result<void, StorageError>> {
    if (this.config.mode === 'local') {
      return { ok: true, value: undefined };
    }
    try {
      const response = await fetch(`${this.baseUrl}/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [id],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: {
            type: 'vector_store',
            message: `Failed to delete vector: ${response.statusText}`,
            cause: errorData,
          },
        };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'vector_store',
          message: 'Failed to delete vector',
          cause: error,
        },
      };
    }
  }
}
