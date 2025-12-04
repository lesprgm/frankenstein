/**
 * LifecycleManager - Orchestrates lifecycle evaluation, state transitions, and background jobs
 */

import { StorageAdapter } from '../adapter.js';
import { VectorizeAdapter } from '../vectorize.js';
import { Result, StorageError } from '../errors.js';
import { Memory, MemoryType, LifecycleState } from '../models.js';
import { Logger } from '../client.js';
import { DecayCalculator, DecayFunction, DECAY_FUNCTIONS } from './decay-calculator.js';
import { ImportanceScorer, ImportanceWeights, AccessMetrics } from './importance-scorer.js';
import { ArchivalService } from './archival-service.js';
import { CleanupService } from './cleanup-service.js';
import { LifecycleEventLogger } from './lifecycle-event-logger.js';
import { validateTransition, TransitionContext } from './state-machine.js';

/**
 * Retention policy for a memory type
 */
export interface RetentionPolicy {
  ttl: number; // milliseconds
  importanceMultiplier: number; // extends TTL for high-importance memories
  gracePeriod: number; // milliseconds before accelerated decay for unused memories
}

/**
 * Configuration for LifecycleManager
 */
export interface LifecycleConfig {
  enabled: boolean;
  defaultTTL: number; // milliseconds
  retentionPolicies: Map<MemoryType, RetentionPolicy>;
  decayFunction: DecayFunction;
  decayThreshold: number; // 0-1, threshold for entering decaying state
  importanceWeights: ImportanceWeights;
  evaluationInterval: number; // milliseconds between background jobs
  batchSize: number; // memories to process per batch
  archiveRetentionPeriod: number; // milliseconds before archived → expired
  auditRetentionPeriod: number; // milliseconds to keep lifecycle events
}

/**
 * Result of a batch evaluation
 */
export interface EvaluationResult {
  memoriesEvaluated: number;
  stateTransitions: number;
  memoriesArchived: number;
  errors: Array<{ memoryId: string; error: StorageError }>;
}

/**
 * Lifecycle metrics for a workspace
 */
export interface LifecycleMetrics {
  stateCounts: Record<LifecycleState, number>;
  totalMemories: number;
  pinnedMemories: number;
  storageByState: Record<LifecycleState, number>; // bytes
  averageDecayScore: number;
  averageImportanceScore: number;
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
 * LifecycleManager orchestrates all lifecycle operations
 */
export class LifecycleManager {
  private decayCalculator: DecayCalculator;
  private importanceScorer: ImportanceScorer;
  private archivalService: ArchivalService;
  private cleanupService: CleanupService;
  private eventLogger: LifecycleEventLogger;
  private backgroundJobInterval: NodeJS.Timeout | null = null;
  private cleanupJobInterval: NodeJS.Timeout | null = null;

  constructor(
    private adapter: StorageAdapter,
    private vectorize: VectorizeAdapter,
    private config: LifecycleConfig,
    private logger: Logger = defaultLogger
  ) {
    // Validate configuration
    this.validateConfig(config);

    // Initialize components
    this.decayCalculator = new DecayCalculator(config.decayFunction);
    this.importanceScorer = new ImportanceScorer(config.importanceWeights);
    this.archivalService = new ArchivalService(adapter, vectorize, logger);
    this.cleanupService = new CleanupService(adapter, logger);
    this.eventLogger = new LifecycleEventLogger(adapter);

    this.logger.info('LifecycleManager initialized', {
      enabled: config.enabled,
      defaultTTL: config.defaultTTL,
      decayThreshold: config.decayThreshold,
      evaluationInterval: config.evaluationInterval,
      batchSize: config.batchSize,
    });
  }

  /**
   * Record a memory access and update importance score
   */
  async recordAccess(memoryId: string, workspaceId: string): Promise<Result<void, StorageError>> {
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
      this.logger.info('Recording memory access', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      // Fetch the memory
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

      // Get relationship count for importance calculation
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

      // Calculate new importance score
      const accessMetrics: AccessMetrics = {
        access_count: memory.access_count + 1,
        last_accessed_at: new Date(),
        created_at: new Date(memory.created_at), // Convert string to Date
        relationship_count: relationshipCount,
        confidence: memory.confidence,
      };

      const newImportanceScore = this.importanceScorer.calculateImportance(accessMetrics);

      // Update memory with new access data
      const now = new Date().toISOString();
      const updateResult = await this.adapter.query<any>(
        `UPDATE memories 
         SET last_accessed_at = $1, 
             access_count = access_count + 1,
             importance_score = $2,
             updated_at = $3
         WHERE id = $4 AND workspace_id = $5`,
        [now, newImportanceScore, now, memoryId, workspaceId]
      );

      if (!updateResult.ok) {
        this.logger.error('Failed to update memory access', {
          memory_id: memoryId,
          error: updateResult.error,
        });
        return updateResult as Result<never, StorageError>;
      }

      this.logger.info('Successfully recorded memory access', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        new_access_count: memory.access_count + 1,
        new_importance_score: newImportanceScore,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error recording access', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to record memory access',
          cause: error,
        },
      };
    }
  }

  /**
   * Pin a memory to prevent automatic lifecycle transitions
   */
  async pinMemory(
    memoryId: string,
    workspaceId: string,
    userId: string
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

    if (!userId || !userId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'userId',
          message: 'User ID is required',
        },
      };
    }

    try {
      this.logger.info('Pinning memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        user_id: userId,
      });

      // Fetch the memory to get current state
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
      const previousState = memory.lifecycle_state;

      // Update memory to pinned state
      const now = new Date().toISOString();
      const updateResult = await this.adapter.query<any>(
        `UPDATE memories 
         SET lifecycle_state = $1,
             pinned = $2,
             pinned_by = $3,
             pinned_at = $4,
             updated_at = $5
         WHERE id = $6 AND workspace_id = $7`,
        ['pinned', 1, userId, now, now, memoryId, workspaceId]
      );

      if (!updateResult.ok) {
        this.logger.error('Failed to pin memory', {
          memory_id: memoryId,
          error: updateResult.error,
        });
        return updateResult as Result<never, StorageError>;
      }

      // Log the transition
      await this.eventLogger.logTransition({
        memory_id: memoryId,
        workspace_id: workspaceId,
        previous_state: previousState,
        new_state: 'pinned',
        reason: 'Memory pinned by user',
        triggered_by: 'user',
        user_id: userId,
        metadata: {
          pinned_at: now,
        },
      });

      this.logger.info('Successfully pinned memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        user_id: userId,
        previous_state: previousState,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error pinning memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to pin memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Unpin a memory and resume lifecycle management
   */
  async unpinMemory(
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
      this.logger.info('Unpinning memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      // Fetch the memory
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

      // Determine the new state based on current conditions
      const now = new Date();
      const lastAccessed = new Date(memory.last_accessed_at); // Convert string to Date
      const decayScore = this.decayCalculator.calculateDecayScore(lastAccessed, now);
      const newState: LifecycleState = decayScore < this.config.decayThreshold ? 'decaying' : 'active';

      // Update memory to unpinned state
      const nowStr = now.toISOString();
      const updateResult = await this.adapter.query<any>(
        `UPDATE memories 
         SET lifecycle_state = $1,
             pinned = $2,
             pinned_by = NULL,
             pinned_at = NULL,
             decay_score = $3,
             updated_at = $4
         WHERE id = $5 AND workspace_id = $6`,
        [newState, 0, decayScore, nowStr, memoryId, workspaceId]
      );

      if (!updateResult.ok) {
        this.logger.error('Failed to unpin memory', {
          memory_id: memoryId,
          error: updateResult.error,
        });
        return updateResult as Result<never, StorageError>;
      }

      // Log the transition
      await this.eventLogger.logTransition({
        memory_id: memoryId,
        workspace_id: workspaceId,
        previous_state: 'pinned',
        new_state: newState,
        reason: 'Memory unpinned, resuming lifecycle management',
        triggered_by: 'user',
        metadata: {
          unpinned_at: nowStr,
          decay_score: decayScore,
        },
      });

      this.logger.info('Successfully unpinned memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        new_state: newState,
        decay_score: decayScore,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error unpinning memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to unpin memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Manually archive a memory
   */
  async archiveMemory(
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
      this.logger.info('Manually archiving memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      // Use the archival service to archive the memory
      const archiveResult = await this.archivalService.archiveBatch(
        [memoryId],
        workspaceId,
        { batchSize: 1, includeRelationships: true }
      );

      if (!archiveResult.ok) {
        this.logger.error('Failed to archive memory', {
          memory_id: memoryId,
          error: archiveResult.error,
        });
        return archiveResult as Result<never, StorageError>;
      }

      if (archiveResult.value.errors.length > 0) {
        const error = archiveResult.value.errors[0].error;
        this.logger.error('Failed to archive memory', {
          memory_id: memoryId,
          error,
        });
        return {
          ok: false,
          error,
        };
      }

      this.logger.info('Successfully archived memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error archiving memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
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
   * Restore an archived memory to active state
   */
  async restoreMemory(
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
      this.logger.info('Restoring archived memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      // Use the archival service to restore the memory
      const restoreResult = await this.archivalService.restore(memoryId, workspaceId);

      if (!restoreResult.ok) {
        this.logger.error('Failed to restore memory', {
          memory_id: memoryId,
          error: restoreResult.error,
        });
        return restoreResult;
      }

      this.logger.info('Successfully restored memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
      });

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error restoring memory', {
        memory_id: memoryId,
        workspace_id: workspaceId,
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
   * Get lifecycle metrics for a workspace
   */
  async getMetrics(workspaceId: string): Promise<Result<LifecycleMetrics, StorageError>> {
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

    try {
      this.logger.info('Calculating lifecycle metrics', {
        workspace_id: workspaceId,
      });

      // Get state counts
      const stateCountsResult = await this.adapter.query<any>(
        `SELECT lifecycle_state, COUNT(*) as count 
         FROM memories 
         WHERE workspace_id = $1 
         GROUP BY lifecycle_state`,
        [workspaceId]
      );

      if (!stateCountsResult.ok) {
        return stateCountsResult as Result<never, StorageError>;
      }

      const stateCounts: Record<LifecycleState, number> = {
        active: 0,
        decaying: 0,
        archived: 0,
        expired: 0,
        pinned: 0,
      };

      let totalMemories = 0;
      for (const row of stateCountsResult.value) {
        const count = typeof row.count === 'string' ? parseInt(row.count, 10) : Number(row.count);
        // Handle potential alias or direct column name
        const state = row.lifecycle_state || row.state;
        if (state) {
          stateCounts[state as LifecycleState] = count;
          totalMemories += count;
        }
      }

      // Get pinned count
      const pinnedCountResult = await this.adapter.query<any>(
        `SELECT COUNT(*) as count 
         FROM memories 
         WHERE workspace_id = $1 AND pinned = $2`,
        [workspaceId, 1]
      );

      let pinnedMemories = 0;
      if (pinnedCountResult.ok && pinnedCountResult.value.length > 0) {
        const countValue = pinnedCountResult.value[0].count;
        pinnedMemories = typeof countValue === 'string' ? parseInt(countValue, 10) : Number(countValue);
      }

      // Calculate storage by state (approximate)
      const storageResult = await this.adapter.query<any>(
        `SELECT lifecycle_state, SUM(LENGTH(content)) as storage 
         FROM memories 
         WHERE workspace_id = $1 
         GROUP BY lifecycle_state`,
        [workspaceId]
      );

      const storageByState: Record<LifecycleState, number> = {
        active: 0,
        decaying: 0,
        archived: 0,
        expired: 0,
        pinned: 0,
      };

      if (storageResult.ok) {
        for (const row of storageResult.value) {
          const storage = typeof row.storage === 'string' ? parseInt(row.storage, 10) : Number(row.storage);
          const state = row.lifecycle_state || row.state;
          if (state) {
            storageByState[state as LifecycleState] = storage || 0;
          }
        }
      }

      // Get archived stats from archived_memories table
      const archivedStatsResult = await this.adapter.query<any>(
        `SELECT COUNT(*) as count, SUM(LENGTH(content)) as size 
         FROM archived_memories 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      if (archivedStatsResult.ok && archivedStatsResult.value.length > 0) {
        const row = archivedStatsResult.value[0];
        const count = typeof row.count === 'string' ? parseInt(row.count, 10) : Number(row.count);
        const size = typeof row.size === 'string' ? parseInt(row.size, 10) : Number(row.size);

        stateCounts.archived = count;
        storageByState.archived = size || 0;
        // Note: archived memories are NOT added to totalMemories (active working set)
      }

      // Calculate average scores
      const scoresResult = await this.adapter.query<any>(
        `SELECT AVG(decay_score) as avg_decay, AVG(importance_score) as avg_importance 
         FROM memories 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      let averageDecayScore = 0;
      let averageImportanceScore = 0;
      if (scoresResult.ok && scoresResult.value.length > 0) {
        averageDecayScore = Number(scoresResult.value[0].avg_decay) || 0;
        averageImportanceScore = Number(scoresResult.value[0].avg_importance) || 0;
      }

      const metrics: LifecycleMetrics = {
        stateCounts,
        totalMemories,
        pinnedMemories,
        storageByState,
        averageDecayScore,
        averageImportanceScore,
      };

      this.logger.info('Successfully calculated lifecycle metrics', {
        workspace_id: workspaceId,
        total_memories: totalMemories,
        pinned_memories: pinnedMemories,
      });

      return { ok: true, value: metrics };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to calculate lifecycle metrics',
          cause: error,
        },
      };
    }
  }

  /**
   * Start background evaluation and cleanup jobs
   */
  startBackgroundJobs(): void {
    if (!this.config.enabled) {
      this.logger.warn('Lifecycle management is disabled, not starting background jobs');
      return;
    }

    if (this.backgroundJobInterval !== null || this.cleanupJobInterval !== null) {
      this.logger.warn('Background jobs already running');
      return;
    }

    const cleanupInterval = this.config.evaluationInterval * 24; // Run cleanup daily by default relative to eval

    this.logger.info('Starting background lifecycle jobs', {
      evaluation_interval: this.config.evaluationInterval,
      cleanup_interval: cleanupInterval,
    });

    // Run immediately
    this.runBackgroundEvaluation().catch((error) => {
      this.logger.error('Background evaluation failed', { error });
    });
    this.runBackgroundCleanup().catch((error) => {
      this.logger.error('Background cleanup failed', { error });
    });

    // Schedule evaluation job
    this.backgroundJobInterval = setInterval(() => {
      this.runBackgroundEvaluation().catch((error) => {
        this.logger.error('Background evaluation failed', { error });
      });
    }, this.config.evaluationInterval);

    // Schedule cleanup job
    this.cleanupJobInterval = setInterval(() => {
      this.runBackgroundCleanup().catch((error) => {
        this.logger.error('Background cleanup failed', { error });
      });
    }, cleanupInterval);
  }

  /**
   * Stop background jobs
   */
  stopBackgroundJobs(): void {
    if (this.backgroundJobInterval === null && this.cleanupJobInterval === null) {
      this.logger.warn('Background jobs not running');
      return;
    }

    this.logger.info('Stopping background lifecycle jobs');
    if (this.backgroundJobInterval) {
      clearInterval(this.backgroundJobInterval);
      this.backgroundJobInterval = null;
    }
    if (this.cleanupJobInterval) {
      clearInterval(this.cleanupJobInterval);
      this.cleanupJobInterval = null;
    }
  }

  /**
   * Run background cleanup for all workspaces
   */
  private async runBackgroundCleanup(): Promise<void> {
    const startTime = Date.now();
    this.logger.info('Running background cleanup');

    try {
      // Get all workspaces
      const workspacesResult = await this.adapter.query<any>(
        'SELECT DISTINCT workspace_id FROM memories',
        []
      );

      if (!workspacesResult.ok) {
        this.logger.error('Failed to get workspaces for cleanup', {
          error: workspacesResult.error,
        });
        return;
      }

      // Cleanup each workspace
      for (const row of workspacesResult.value) {
        const workspaceId = row.workspace_id;

        // 1. Cleanup expired memories
        const cleanupResult = await this.cleanupService.cleanupExpired(workspaceId, {
          batchSize: this.config.batchSize,
          dryRun: false
        });

        if (!cleanupResult.ok) {
          this.logger.error('Cleanup expired failed', {
            workspace_id: workspaceId,
            error: cleanupResult.error
          });
        }

        // 2. Cleanup old lifecycle events (retain for configured period)
        const eventCleanupResult = await this.cleanupService.cleanupLifecycleEvents(
          workspaceId,
          this.config.auditRetentionPeriod
        );

        if (!eventCleanupResult.ok) {
          this.logger.error('Cleanup events failed', {
            workspace_id: workspaceId,
            error: eventCleanupResult.error
          });
        }
      }

      this.logger.info('Background cleanup completed', {
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error('Unexpected error in background cleanup', {
        error,
        duration_ms: Date.now() - startTime,
      });
    }
  }

  /**
   * Run background evaluation for all workspaces
   * This is a simplified version - in production, this would be more sophisticated
   */
  private async runBackgroundEvaluation(): Promise<void> {
    const startTime = Date.now();
    this.logger.info('Running background lifecycle evaluation');

    try {
      // Get all workspaces
      const workspacesResult = await this.adapter.query<any>(
        'SELECT DISTINCT workspace_id FROM memories',
        []
      );

      if (!workspacesResult.ok) {
        this.logger.error('Failed to get workspaces for evaluation', {
          error: workspacesResult.error,
        });
        return;
      }

      // Evaluate each workspace
      for (const row of workspacesResult.value) {
        const workspaceId = row.workspace_id;

        // Evaluate in batches
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const result = await this.evaluateBatch(workspaceId, offset, this.config.batchSize);

          if (!result.ok) {
            this.logger.error('Batch evaluation failed', {
              workspace_id: workspaceId,
              offset,
              error: result.error,
            });
            break;
          }

          if (result.value.memoriesEvaluated < this.config.batchSize) {
            hasMore = false;
          } else {
            offset += this.config.batchSize;
          }
        }

        // Log metrics for the workspace
        try {
          const metrics = await this.getMetrics(workspaceId);
          this.logger.info('Lifecycle metrics', {
            workspace_id: workspaceId,
            metrics,
          });
        } catch (error) {
          this.logger.warn('Failed to collect metrics after evaluation', {
            workspace_id: workspaceId,
            error,
          });
        }
      }

      this.logger.info('Background evaluation completed', {
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error('Unexpected error in background evaluation', {
        error,
        duration_ms: Date.now() - startTime,
      });
    }
  }

  /**
   * Validate configuration
   */
  private validateConfig(config: LifecycleConfig): void {
    if (config.defaultTTL <= 0) {
      throw new Error('defaultTTL must be positive');
    }

    if (config.decayThreshold < 0 || config.decayThreshold > 1) {
      throw new Error('decayThreshold must be between 0 and 1');
    }

    if (config.evaluationInterval <= 0) {
      throw new Error('evaluationInterval must be positive');
    }

    // Enforce minimum evaluation interval of 1 minute to prevent excessive load
    if (config.evaluationInterval < 60000) {
      throw new Error('evaluationInterval must be at least 1 minute (60000ms)');
    }

    if (config.batchSize < 1 || config.batchSize > 10000) {
      throw new Error('batchSize must be between 1 and 10000');
    }

    if (config.archiveRetentionPeriod <= 0) {
      throw new Error('archiveRetentionPeriod must be positive');
    }

    if (config.auditRetentionPeriod <= 0) {
      throw new Error('auditRetentionPeriod must be positive');
    }

    // Validate importance weights
    const weights = config.importanceWeights;
    if (weights.accessFrequency < 0 || weights.confidence < 0 || weights.relationshipCount < 0) {
      throw new Error('Importance weights must be non-negative');
    }

    // Warn if weights don't sum to approximately 1.0 (soft validation)
    const sum = weights.accessFrequency + weights.confidence + weights.relationshipCount;
    if (Math.abs(sum - 1.0) > 0.01) {
      this.logger.warn('Importance weights do not sum to 1.0', { sum, weights });
    }
  }

  /**
   * Evaluate lifecycle states for a batch of memories
   */
  async evaluateBatch(
    workspaceId: string,
    offset: number,
    limit: number
  ): Promise<Result<EvaluationResult, StorageError>> {
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

    if (limit < 1 || limit > 10000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 10000',
        },
      };
    }

    const result: EvaluationResult = {
      memoriesEvaluated: 0,
      stateTransitions: 0,
      memoriesArchived: 0,
      errors: [],
    };

    try {
      this.logger.info('Starting batch evaluation', {
        workspace_id: workspaceId,
        offset,
        limit,
      });

      // Fetch memories for evaluation (exclude pinned memories from automatic transitions)
      const memoriesResult = await this.adapter.query<Memory>(
        `SELECT m.*, 
                (SELECT COUNT(*) FROM relationships r 
                 WHERE r.from_memory_id = m.id OR r.to_memory_id = m.id) as relationship_count
         FROM memories m
         WHERE m.workspace_id = $1
         ORDER BY m.created_at ASC
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      );

      if (!memoriesResult.ok) {
        this.logger.error('Failed to fetch memories for evaluation', {
          workspace_id: workspaceId,
          error: memoriesResult.error,
        });
        return memoriesResult as Result<never, StorageError>;
      }

      const memories = memoriesResult.value;
      result.memoriesEvaluated = memories.length;

      if (memories.length === 0) {
        this.logger.info('No memories to evaluate', {
          workspace_id: workspaceId,
          offset,
        });
        return { ok: true, value: result };
      }

      this.logger.info('Evaluating memories', {
        workspace_id: workspaceId,
        count: memories.length,
      });

      const now = new Date();
      const memoriesToArchive: string[] = [];

      // Evaluate each memory
      for (const memory of memories) {
        try {
          // Skip pinned memories for automatic transitions
          if (memory.pinned) {
            this.logger.info('Skipping pinned memory', {
              memory_id: memory.id,
            });
            continue;
          }

          // Calculate decay score
          const lastAccessed = new Date(memory.last_accessed_at); // Convert string to Date
          const decayScore = this.decayCalculator.calculateDecayScore(
            lastAccessed,
            now
          );

          // Get retention policy for this memory type
          const policy = this.config.retentionPolicies.get(memory.type) || {
            ttl: this.config.defaultTTL,
            importanceMultiplier: 1.0,
            gracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
          };

          // Calculate effective TTL based on importance score
          const effectiveTTL = policy.ttl * (1 + (memory.importance_score * policy.importanceMultiplier));

          // Calculate age
          const createdAt = new Date(memory.created_at); // Convert string to Date
          const ageMs = now.getTime() - createdAt.getTime();

          // Determine new state
          let newState: LifecycleState = memory.lifecycle_state;
          let shouldArchive = false;
          let transitionReason = '';

          // Check if memory should be archived (TTL exceeded)
          if (ageMs > effectiveTTL) {
            // Check if memory has been accessed (not in grace period for unused memories)
            if (memory.access_count === 0 && ageMs > policy.gracePeriod) {
              // Unused memory past grace period - archive immediately
              newState = 'archived';
              shouldArchive = true;
              transitionReason = 'Memory exceeded TTL without any access';
            } else if (memory.access_count > 0) {
              // Used memory past TTL - archive
              newState = 'archived';
              shouldArchive = true;
              transitionReason = 'Memory exceeded effective TTL';
            }
          } else if (decayScore < this.config.decayThreshold && memory.lifecycle_state === 'active') {
            // Decay score below threshold - transition to decaying
            newState = 'decaying';
            transitionReason = 'Decay score fell below threshold';
          } else if (decayScore >= this.config.decayThreshold && memory.lifecycle_state === 'decaying') {
            // Decay score recovered - transition back to active
            newState = 'active';
            transitionReason = 'Decay score recovered above threshold';
          }

          // Update memory if state changed or decay score needs updating
          if (newState !== memory.lifecycle_state || Math.abs(decayScore - memory.decay_score) > 0.01) {
            // Validate state transition
            const transitionValidation = validateTransition({
              fromState: memory.lifecycle_state,
              toState: newState,
              isPinned: memory.pinned,
              triggeredBy: 'system',
              reason: transitionReason,
            });

            if (!transitionValidation.ok) {
              this.logger.error('State transition validation failed', {
                memory_id: memory.id,
                from_state: memory.lifecycle_state,
                to_state: newState,
                error: transitionValidation.error,
              });
              result.errors.push({
                memoryId: memory.id,
                error: transitionValidation.error,
              });
              continue;
            }

            if (!transitionValidation.value.valid) {
              this.logger.warn('Invalid state transition', {
                memory_id: memory.id,
                from_state: memory.lifecycle_state,
                to_state: newState,
                reason: transitionValidation.value.reason,
              });
              continue;
            }

            // Update memory in database
            const updateResult = await this.adapter.query<any>(
              `UPDATE memories 
               SET lifecycle_state = $1,
                   decay_score = $2,
                   effective_ttl = $3,
                   updated_at = $4
               WHERE id = $5 AND workspace_id = $6`,
              [newState, decayScore, effectiveTTL, now.toISOString(), memory.id, workspaceId]
            );

            if (!updateResult.ok) {
              this.logger.error('Failed to update memory lifecycle state', {
                memory_id: memory.id,
                error: updateResult.error,
              });
              result.errors.push({
                memoryId: memory.id,
                error: updateResult.error,
              });
              continue;
            }

            // Log state transition if state changed
            if (newState !== memory.lifecycle_state) {
              await this.eventLogger.logTransition({
                memory_id: memory.id,
                workspace_id: workspaceId,
                previous_state: memory.lifecycle_state,
                new_state: newState,
                reason: transitionReason,
                triggered_by: 'system',
                metadata: {
                  decay_score: decayScore,
                  effective_ttl: effectiveTTL,
                  age_ms: ageMs,
                  importance_score: memory.importance_score,
                },
              });

              result.stateTransitions++;

              this.logger.info('Memory state transitioned', {
                memory_id: memory.id,
                from_state: memory.lifecycle_state,
                to_state: newState,
                decay_score: decayScore,
                effective_ttl: effectiveTTL,
              });
            }

            // Add to archival list if needed
            if (shouldArchive) {
              memoriesToArchive.push(memory.id);
            }
          }
        } catch (error) {
          this.logger.error('Error evaluating memory', {
            memory_id: memory.id,
            error,
          });
          result.errors.push({
            memoryId: memory.id,
            error: {
              type: 'database',
              message: 'Failed to evaluate memory',
              cause: error,
            },
          });
        }
      }

      // Archive memories that exceeded TTL
      if (memoriesToArchive.length > 0) {
        this.logger.info('Archiving memories', {
          workspace_id: workspaceId,
          count: memoriesToArchive.length,
        });

        const archiveResult = await this.archivalService.archiveBatch(
          memoriesToArchive,
          workspaceId,
          { batchSize: 100, includeRelationships: true }
        );

        if (archiveResult.ok) {
          result.memoriesArchived = archiveResult.value.memoriesArchived;

          // Add archival errors to result
          for (const error of archiveResult.value.errors) {
            result.errors.push(error);
          }

          this.logger.info('Archival completed', {
            workspace_id: workspaceId,
            memories_archived: result.memoriesArchived,
            errors: archiveResult.value.errors.length,
          });
        } else {
          this.logger.error('Archival failed', {
            workspace_id: workspaceId,
            error: archiveResult.error,
          });
        }
      }

      this.logger.info('Batch evaluation completed', {
        workspace_id: workspaceId,
        memories_evaluated: result.memoriesEvaluated,
        state_transitions: result.stateTransitions,
        memories_archived: result.memoriesArchived,
        errors: result.errors.length,
      });

      return { ok: true, value: result };
    } catch (error) {
      this.logger.error('Unexpected error during batch evaluation', {
        workspace_id: workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to evaluate batch',
          cause: error,
        },
      };
    }
  }
}
