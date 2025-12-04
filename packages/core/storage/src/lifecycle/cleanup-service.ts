/**
 * CleanupService - Handles permanent deletion of expired memories
 */

import { StorageAdapter } from '../adapter.js';
import { Result, StorageError } from '../errors.js';
import { Logger } from '../client.js';
import { LifecycleEventLogger } from './lifecycle-event-logger.js';

/**
 * Options for cleanup operations
 */
export interface CleanupOptions {
  batchSize?: number;
  dryRun?: boolean;
}

/**
 * Error details for failed cleanup operations
 */
export interface CleanupError {
  memoryId: string;
  error: StorageError;
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  memoriesDeleted: number;
  relationshipsDeleted: number;
  storageReclaimed: number; // bytes
  executionTime: number; // milliseconds
  errors: CleanupError[];
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
 * CleanupService handles permanent deletion of expired memories
 */
export class CleanupService {
  private eventLogger: LifecycleEventLogger;

  constructor(
    private adapter: StorageAdapter,
    private logger: Logger = defaultLogger
  ) {
    this.eventLogger = new LifecycleEventLogger(adapter);
  }

  /**
   * Delete expired memories permanently
   */
  async cleanupExpired(
    workspaceId: string,
    options?: CleanupOptions
  ): Promise<Result<CleanupResult, StorageError>> {
    const startTime = Date.now();

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

    const batchSize = options?.batchSize ?? 100;
    const dryRun = options?.dryRun ?? false;

    // Validate batch size
    if (batchSize < 1 || batchSize > 1000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'batchSize',
          message: 'Batch size must be between 1 and 1000',
        },
      };
    }

    const result: CleanupResult = {
      memoriesDeleted: 0,
      relationshipsDeleted: 0,
      storageReclaimed: 0,
      executionTime: 0,
      errors: [],
    };

    this.logger.info('Starting cleanup of expired memories', {
      workspace_id: workspaceId,
      batch_size: batchSize,
      dry_run: dryRun,
    });

    try {
      // Find all expired memories in archived_memories table
      const expiredResult = await this.adapter.query<any>(
        `SELECT id, content, metadata FROM archived_memories 
         WHERE workspace_id = $1 AND expires_at IS NOT NULL AND expires_at <= $2
         ORDER BY expires_at ASC`,
        [workspaceId, new Date().toISOString()]
      );

      if (!expiredResult.ok) {
        this.logger.error('Failed to query expired memories', {
          workspace_id: workspaceId,
          error: expiredResult.error,
        });
        return expiredResult as Result<never, StorageError>;
      }

      const expiredMemories = expiredResult.value;

      if (expiredMemories.length === 0) {
        this.logger.info('No expired memories found', {
          workspace_id: workspaceId,
        });
        result.executionTime = Date.now() - startTime;
        return { ok: true, value: result };
      }

      this.logger.info('Found expired memories', {
        workspace_id: workspaceId,
        count: expiredMemories.length,
      });

      // Process memories in batches
      for (let i = 0; i < expiredMemories.length; i += batchSize) {
        const batch = expiredMemories.slice(i, i + batchSize);

        this.logger.info('Processing cleanup batch', {
          batch_number: Math.floor(i / batchSize) + 1,
          batch_size: batch.length,
        });

        for (const memory of batch) {
          const cleanupResult = await this.cleanupSingle(
            memory.id,
            workspaceId,
            memory,
            dryRun
          );

          if (!cleanupResult.ok) {
            this.logger.error('Failed to cleanup memory', {
              memory_id: memory.id,
              error: cleanupResult.error,
            });
            result.errors.push({
              memoryId: memory.id,
              error: cleanupResult.error,
            });
            continue;
          }

          result.memoriesDeleted++;
          result.relationshipsDeleted += cleanupResult.value.relationshipsDeleted;
          result.storageReclaimed += cleanupResult.value.storageReclaimed;
        }
      }

      result.executionTime = Date.now() - startTime;

      this.logger.info('Cleanup completed', {
        workspace_id: workspaceId,
        memories_deleted: result.memoriesDeleted,
        relationships_deleted: result.relationshipsDeleted,
        storage_reclaimed: result.storageReclaimed,
        execution_time: result.executionTime,
        errors: result.errors.length,
        dry_run: dryRun,
      });

      return { ok: true, value: result };
    } catch (error) {
      this.logger.error('Unexpected error during cleanup', {
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to cleanup expired memories',
          cause: error,
        },
      };
    }
  }

  /**
   * Cleanup a single expired memory
   */
  private async cleanupSingle(
    memoryId: string,
    workspaceId: string,
    memoryData: any,
    dryRun: boolean
  ): Promise<Result<{ relationshipsDeleted: number; storageReclaimed: number }, StorageError>> {
    try {
      // Calculate storage reclaimed (approximate)
      const contentSize = memoryData.content ? memoryData.content.length : 0;
      const metadataSize = memoryData.metadata 
        ? (typeof memoryData.metadata === 'string' 
            ? memoryData.metadata.length 
            : JSON.stringify(memoryData.metadata).length)
        : 0;
      const storageReclaimed = contentSize + metadataSize;

      // Count relationships
      const relationshipsResult = await this.adapter.query<any>(
        `SELECT COUNT(*) as count FROM relationships 
         WHERE from_memory_id = $1 OR to_memory_id = $1`,
        [memoryId]
      );

      let relationshipCount = 0;
      if (relationshipsResult.ok && relationshipsResult.value.length > 0) {
        const countValue = relationshipsResult.value[0].count;
        relationshipCount = typeof countValue === 'string' ? parseInt(countValue, 10) : Number(countValue);
        relationshipCount = isNaN(relationshipCount) ? 0 : relationshipCount;
      }

      if (dryRun) {
        this.logger.info('Dry run: would delete memory', {
          memory_id: memoryId,
          relationships: relationshipCount,
          storage_reclaimed: storageReclaimed,
        });
        return {
          ok: true,
          value: {
            relationshipsDeleted: relationshipCount,
            storageReclaimed,
          },
        };
      }

      // Delete relationships
      if (relationshipCount > 0) {
        const deleteRelationshipsResult = await this.adapter.query<any>(
          `DELETE FROM relationships 
           WHERE from_memory_id = $1 OR to_memory_id = $1`,
          [memoryId]
        );

        if (!deleteRelationshipsResult.ok) {
          this.logger.error('Failed to delete relationships', {
            memory_id: memoryId,
            error: deleteRelationshipsResult.error,
          });
          // Continue with memory deletion even if relationship deletion fails
        }
      }

      // Log the transition to expired state before deletion
      await this.eventLogger.logTransition({
        memory_id: memoryId,
        workspace_id: workspaceId,
        previous_state: 'archived',
        new_state: 'expired',
        reason: 'Memory expired and permanently deleted',
        triggered_by: 'system',
        metadata: {
          relationships_deleted: relationshipCount,
          storage_reclaimed: storageReclaimed,
        },
      });

      // Delete from archived_memories table
      const deleteResult = await this.adapter.delete('archived_memories', memoryId);
      if (!deleteResult.ok) {
        this.logger.error('Failed to delete from archived_memories', {
          memory_id: memoryId,
          error: deleteResult.error,
        });
        return deleteResult as Result<never, StorageError>;
      }

      this.logger.info('Successfully deleted expired memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        relationships_deleted: relationshipCount,
        storage_reclaimed: storageReclaimed,
      });

      return {
        ok: true,
        value: {
          relationshipsDeleted: relationshipCount,
          storageReclaimed,
        },
      };
    } catch (error) {
      this.logger.error('Unexpected error cleaning up memory', {
        memory_id: memoryId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to cleanup memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Delete lifecycle events older than audit retention period
   */
  async cleanupLifecycleEvents(
    workspaceId: string,
    retentionPeriodMs: number
  ): Promise<Result<number, StorageError>> {
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

    if (retentionPeriodMs <= 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'retentionPeriodMs',
          message: 'Retention period must be positive',
        },
      };
    }

    try {
      this.logger.info('Starting cleanup of lifecycle events', {
        workspace_id: workspaceId,
        retention_period_ms: retentionPeriodMs,
      });

      // Calculate cutoff date
      const cutoffDate = new Date(Date.now() - retentionPeriodMs);

      // Delete old lifecycle events
      const deleteResult = await this.adapter.query<any>(
        `DELETE FROM lifecycle_events 
         WHERE workspace_id = $1 AND created_at < $2`,
        [workspaceId, cutoffDate.toISOString()]
      );

      if (!deleteResult.ok) {
        this.logger.error('Failed to delete lifecycle events', {
          workspace_id: workspaceId,
          error: deleteResult.error,
        });
        return deleteResult as Result<never, StorageError>;
      }

      // Get the count of deleted rows
      // Note: Different databases return this differently
      // For SQLite, we need to use changes() function
      // For Postgres, we can use RETURNING clause
      // For now, we'll query the count before and after
      const countResult = await this.adapter.query<any>(
        `SELECT COUNT(*) as count FROM lifecycle_events 
         WHERE workspace_id = $1 AND created_at < $2`,
        [workspaceId, cutoffDate.toISOString()]
      );

      let deletedCount = 0;
      if (countResult.ok && countResult.value.length > 0) {
        const countValue = countResult.value[0].count;
        deletedCount = typeof countValue === 'string' ? parseInt(countValue, 10) : Number(countValue);
        deletedCount = isNaN(deletedCount) ? 0 : deletedCount;
      }

      this.logger.info('Lifecycle events cleanup completed', {
        workspace_id: workspaceId,
        events_deleted: deletedCount,
        cutoff_date: cutoffDate.toISOString(),
      });

      return { ok: true, value: deletedCount };
    } catch (error) {
      this.logger.error('Unexpected error cleaning up lifecycle events', {
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to cleanup lifecycle events',
          cause: error,
        },
      };
    }
  }
}
