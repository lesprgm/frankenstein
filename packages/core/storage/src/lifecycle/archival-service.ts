/**
 * ArchivalService - Handles moving memories to/from cold storage
 */

import { StorageAdapter } from '../adapter.js';
import { VectorizeAdapter } from '../vectorize.js';
import { Result, StorageError } from '../errors.js';
import { ArchivedMemory, Memory } from '../models.js';
import { Logger } from '../client.js';
import { LifecycleEventLogger, LogTransitionInput } from './lifecycle-event-logger.js';

/**
 * Options for archival operations
 */
export interface ArchivalOptions {
  batchSize?: number;
  includeRelationships?: boolean;
}

/**
 * Result of an archival operation
 */
export interface ArchivalResult {
  memoriesArchived: number;
  relationshipsPreserved: number;
  vectorsRemoved: number;
  errors: Array<{ memoryId: string; error: StorageError }>;
}

/**
 * Pagination options for listing archived memories
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Default console logger implementation
 */
const defaultLogger: Logger = {
  error: (message: string, context?: object) => console.error(message, context),
  warn: (message: string, context?: object) => console.warn(message, context),
  info: (message: string, context?: object) => console.info(message, context),
};

/**
 * ArchivalService handles moving memories to/from cold storage
 */
export class ArchivalService {
  private eventLogger: LifecycleEventLogger;

  constructor(
    private adapter: StorageAdapter,
    private vectorize: VectorizeAdapter,
    private logger: Logger = defaultLogger
  ) {
    this.eventLogger = new LifecycleEventLogger(adapter);
  }

  /**
   * Archive a batch of memories
   */
  async archiveBatch(
    memoryIds: string[],
    workspaceId: string,
    options?: ArchivalOptions
  ): Promise<Result<ArchivalResult, StorageError>> {
    // Validate input
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    if (!memoryIds || memoryIds.length === 0) {
      return {
        ok: true,
        value: {
          memoriesArchived: 0,
          relationshipsPreserved: 0,
          vectorsRemoved: 0,
          errors: [],
        },
      };
    }

    const batchSize = options?.batchSize ?? 100;
    const includeRelationships = options?.includeRelationships ?? true;

    const result: ArchivalResult = {
      memoriesArchived: 0,
      relationshipsPreserved: 0,
      vectorsRemoved: 0,
      errors: [],
    };

    this.logger.info('Starting batch archival', {
      workspace_id: workspaceId,
      memory_count: memoryIds.length,
      batch_size: batchSize,
    });

    // Process memories in batches
    for (let i = 0; i < memoryIds.length; i += batchSize) {
      const batch = memoryIds.slice(i, i + batchSize);

      this.logger.info('Processing archival batch', {
        batch_number: Math.floor(i / batchSize) + 1,
        batch_size: batch.length,
      });

      for (const memoryId of batch) {
        const archiveResult = await this.archiveSingle(
          memoryId,
          workspaceId,
          includeRelationships
        );

        if (!archiveResult.ok) {
          this.logger.error('Failed to archive memory', {
            memory_id: memoryId,
            error: archiveResult.error,
          });
          result.errors.push({
            memoryId,
            error: archiveResult.error,
          });
          continue;
        }

        result.memoriesArchived++;
        result.relationshipsPreserved += archiveResult.value.relationshipsPreserved;
        if (archiveResult.value.vectorRemoved) {
          result.vectorsRemoved++;
        }
      }
    }

    this.logger.info('Batch archival completed', {
      workspace_id: workspaceId,
      memories_archived: result.memoriesArchived,
      relationships_preserved: result.relationshipsPreserved,
      vectors_removed: result.vectorsRemoved,
      errors: result.errors.length,
    });

    return { ok: true, value: result };
  }

  /**
   * Archive a single memory
   */
  private async archiveSingle(
    memoryId: string,
    workspaceId: string,
    includeRelationships: boolean
  ): Promise<Result<{ relationshipsPreserved: number; vectorRemoved: boolean }, StorageError>> {
    try {
      // Fetch the memory from active storage
      const memoryResult = await this.adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1 AND workspace_id = $2',
        [memoryId, workspaceId]
      );

      if (!memoryResult.ok) {
        return memoryResult as Result<never, StorageError>;
      }

      if (memoryResult.value.length === 0) {
        return {
          ok: false,
          error: {
            type: 'not_found',
            resource: 'memory',
            id: memoryId,
          },
        };
      }

      const memory = memoryResult.value[0];

      // Count relationships if needed
      let relationshipCount = 0;
      if (includeRelationships) {
        const relationshipsResult = await this.adapter.query<any>(
          `SELECT COUNT(*) as count FROM relationships 
           WHERE from_memory_id = $1 OR to_memory_id = $1`,
          [memoryId]
        );

        if (relationshipsResult.ok && relationshipsResult.value.length > 0) {
          // Handle both number and string responses
          const countValue = relationshipsResult.value[0].count;
          relationshipCount = typeof countValue === 'string' ? parseInt(countValue, 10) : Number(countValue);
          relationshipCount = isNaN(relationshipCount) ? 0 : relationshipCount;
        }
      }

      // Insert into archived_memories table
      // Ensure metadata is properly stringified (handle case where it's already a string)
      let metadataStr = '{}';
      if (typeof memory.metadata === 'string') {
        metadataStr = memory.metadata;
      } else if (memory.metadata) {
        metadataStr = JSON.stringify(memory.metadata);
      }

      const archivedMemory = {
        id: memory.id,
        workspace_id: memory.workspace_id,
        conversation_id: memory.conversation_id,
        type: memory.type,
        content: memory.content,
        confidence: memory.confidence,
        metadata: metadataStr,
        created_at: memory.created_at,
        updated_at: memory.updated_at,
        last_accessed_at: memory.last_accessed_at,
        access_count: memory.access_count,
        importance_score: memory.importance_score,
        archived_at: new Date().toISOString(),
        expires_at: memory.expires_at,
      };

      const insertResult = await this.adapter.insert<ArchivedMemory>(
        'archived_memories',
        archivedMemory
      );

      if (!insertResult.ok) {
        this.logger.error('Failed to insert into archived_memories', {
          memory_id: memoryId,
          error: insertResult.error,
        });
        return insertResult as Result<never, StorageError>;
      }

      // Remove from vector index
      let vectorRemoved = false;
      const vectorDeleteResult = await this.vectorize.delete(memoryId);
      if (!vectorDeleteResult.ok) {
        this.logger.warn('Failed to delete vector from index', {
          memory_id: memoryId,
          error: vectorDeleteResult.error,
        });
        // Continue with archival even if vector deletion fails
      } else {
        vectorRemoved = true;
        this.logger.info('Removed vector from index', {
          memory_id: memoryId,
        });
      }

      // Delete from active memories table
      const deleteResult = await this.adapter.delete('memories', memoryId);
      if (!deleteResult.ok) {
        this.logger.error('Failed to delete from memories table', {
          memory_id: memoryId,
          error: deleteResult.error,
        });
        // Try to rollback by deleting from archived_memories
        await this.adapter.delete('archived_memories', memoryId);
        return deleteResult;
      }

      // Log the transition
      const logInput: LogTransitionInput = {
        memory_id: memoryId,
        workspace_id: workspaceId,
        previous_state: memory.lifecycle_state,
        new_state: 'archived',
        reason: 'Memory archived to cold storage',
        triggered_by: 'system',
        metadata: {
          relationships_preserved: relationshipCount,
          vector_removed: vectorRemoved,
        },
      };

      await this.eventLogger.logTransition(logInput);

      this.logger.info('Successfully archived memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        relationships_preserved: relationshipCount,
      });

      return {
        ok: true,
        value: {
          relationshipsPreserved: relationshipCount,
          vectorRemoved,
        },
      };
    } catch (error) {
      this.logger.error('Unexpected error archiving memory', {
        memory_id: memoryId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to archive memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Restore a memory from archive
   */
  async restore(
    memoryId: string,
    workspaceId: string
  ): Promise<Result<void, StorageError>> {
    // Validate input
    if (!memoryId || !memoryId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'memoryId',
          message: 'Memory ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      this.logger.info('Restoring memory from archive', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      // Fetch the archived memory
      const archivedResult = await this.adapter.query<any>(
        'SELECT * FROM archived_memories WHERE id = $1 AND workspace_id = $2',
        [memoryId, workspaceId]
      );

      if (!archivedResult.ok) {
        return archivedResult as Result<never, StorageError>;
      }

      if (archivedResult.value.length === 0) {
        return {
          ok: false,
          error: {
            type: 'not_found',
            resource: 'archived_memory',
            id: memoryId,
          },
        };
      }

      const archivedMemory = archivedResult.value[0];

      // Restore to active memories table
      // Ensure metadata is a string for storage
      let metadataStr = '{}';
      if (typeof archivedMemory.metadata === 'string') {
        metadataStr = archivedMemory.metadata;
      } else if (archivedMemory.metadata) {
        metadataStr = JSON.stringify(archivedMemory.metadata);
      }

      const restoredMemory = {
        id: archivedMemory.id,
        workspace_id: archivedMemory.workspace_id,
        conversation_id: archivedMemory.conversation_id,
        type: archivedMemory.type,
        content: archivedMemory.content,
        confidence: archivedMemory.confidence,
        metadata: metadataStr,
        created_at: archivedMemory.created_at,
        updated_at: new Date().toISOString(),
        lifecycle_state: 'active',
        last_accessed_at: new Date().toISOString(),
        access_count: archivedMemory.access_count + 1, // Increment access count
        importance_score: archivedMemory.importance_score,
        decay_score: 1.0, // Reset decay score on restoration
        effective_ttl: null,
        pinned: 0, // SQLite uses 0/1 for boolean
        pinned_by: null,
        pinned_at: null,
        archived_at: null,
        expires_at: null,
      };

      const insertResult = await this.adapter.insert<Memory>(
        'memories',
        restoredMemory
      );

      if (!insertResult.ok) {
        this.logger.error('Failed to insert restored memory', {
          memory_id: memoryId,
          error: insertResult.error,
        });
        return insertResult as Result<never, StorageError>;
      }

      // Note: Vector re-indexing would require the embedding, which we don't store in archived_memories
      // The caller should re-generate and store the embedding if needed
      this.logger.warn('Memory restored without embedding - re-indexing required', {
        memory_id: memoryId,
      });

      // Delete from archived_memories table
      const deleteResult = await this.adapter.delete('archived_memories', memoryId);
      if (!deleteResult.ok) {
        this.logger.error('Failed to delete from archived_memories', {
          memory_id: memoryId,
          error: deleteResult.error,
        });
        // Try to rollback by deleting from memories
        await this.adapter.delete('memories', memoryId);
        return deleteResult;
      }

      // Log the transition
      const logInput: LogTransitionInput = {
        memory_id: memoryId,
        workspace_id: workspaceId,
        previous_state: 'archived',
        new_state: 'active',
        reason: 'Memory restored from archive due to access',
        triggered_by: 'system',
        metadata: {
          restored_at: new Date().toISOString(),
        },
      };

      await this.eventLogger.logTransition(logInput);

      this.logger.info('Successfully restored memory from archive', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error restoring memory', {
        memory_id: memoryId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to restore memory',
          cause: error,
        },
      };
    }
  }

  /**
   * List archived memories with pagination
   */
  async listArchived(
    workspaceId: string,
    options?: PaginationOptions
  ): Promise<Result<ArchivedMemory[], StorageError>> {
    // Validate input
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Validate pagination parameters
    if (limit < 1 || limit > 1000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 1000',
        },
      };
    }

    if (offset < 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'offset',
          message: 'Offset must be non-negative',
        },
      };
    }

    try {
      this.logger.info('Listing archived memories', {
        workspace_id: workspaceId,
        limit,
        offset,
      });

      const result = await this.adapter.query<any>(
        `SELECT * FROM archived_memories 
         WHERE workspace_id = $1 
         ORDER BY archived_at DESC 
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      );

      if (!result.ok) {
        this.logger.error('Failed to list archived memories', {
          workspace_id: workspaceId,
          error: result.error,
        });
        return result;
      }

      // Parse metadata from JSON string if needed
      const archivedMemories: ArchivedMemory[] = result.value.map((row: any) => {
        let parsedMetadata = row.metadata;
        if (typeof row.metadata === 'string') {
          try {
            parsedMetadata = JSON.parse(row.metadata);
          } catch (e) {
            parsedMetadata = {};
          }
        }
        
        return {
          ...row,
          metadata: parsedMetadata,
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
          last_accessed_at: new Date(row.last_accessed_at),
          archived_at: new Date(row.archived_at),
          expires_at: row.expires_at ? new Date(row.expires_at) : null,
        };
      });

      this.logger.info('Successfully listed archived memories', {
        workspace_id: workspaceId,
        count: archivedMemories.length,
      });

      return { ok: true, value: archivedMemories };
    } catch (error) {
      this.logger.error('Unexpected error listing archived memories', {
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to list archived memories',
          cause: error,
        },
      };
    }
  }
}
