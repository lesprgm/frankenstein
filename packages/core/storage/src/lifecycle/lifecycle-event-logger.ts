/**
 * LifecycleEventLogger - Records lifecycle state transitions for auditability
 */

import { StorageAdapter } from '../adapter.js';
import { Result, StorageError } from '../errors.js';
import { LifecycleEvent, LifecycleState } from '../models.js';
import { randomUUID } from 'crypto';

/**
 * Input for logging a lifecycle transition
 */
export interface LogTransitionInput {
  memory_id: string;
  workspace_id: string;
  previous_state: LifecycleState;
  new_state: LifecycleState;
  reason: string;
  triggered_by: 'system' | 'user';
  user_id?: string | null;
  metadata?: Record<string, any>;
}

/**
 * LifecycleEventLogger handles recording and querying lifecycle state transitions
 */
export class LifecycleEventLogger {
  constructor(private adapter: StorageAdapter) {}

  /**
   * Record a lifecycle state transition
   */
  async logTransition(input: LogTransitionInput): Promise<Result<void, StorageError>> {
    // Validate input
    if (!input.memory_id || !input.memory_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'memory_id',
          message: 'Memory ID is required',
        },
      };
    }

    if (!input.workspace_id || !input.workspace_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspace_id',
          message: 'Workspace ID is required',
        },
      };
    }

    if (!input.reason || !input.reason.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'reason',
          message: 'Reason is required',
        },
      };
    }

    if (input.triggered_by !== 'system' && input.triggered_by !== 'user') {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'triggered_by',
          message: 'triggered_by must be either "system" or "user"',
        },
      };
    }

    try {
      const event = {
        id: randomUUID(),
        memory_id: input.memory_id.trim(),
        workspace_id: input.workspace_id.trim(),
        previous_state: input.previous_state,
        new_state: input.new_state,
        reason: input.reason.trim(),
        triggered_by: input.triggered_by,
        user_id: input.user_id || null,
        metadata: JSON.stringify(input.metadata || {}),
        created_at: new Date().toISOString(),
      };

      const result = await this.adapter.insert<LifecycleEvent>('lifecycle_events', event);

      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
        };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to log lifecycle transition',
          cause: error,
        },
      };
    }
  }

  /**
   * Get lifecycle history for a memory
   */
  async getHistory(
    memoryId: string,
    workspaceId: string
  ): Promise<Result<LifecycleEvent[], StorageError>> {
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
      const result = await this.adapter.query<any>(
        'SELECT * FROM lifecycle_events WHERE memory_id = $1 AND workspace_id = $2 ORDER BY created_at ASC',
        [memoryId, workspaceId]
      );

      if (!result.ok) {
        return result;
      }

      // Parse metadata from JSON string
      const events: LifecycleEvent[] = result.value.map((row: any) => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        created_at: new Date(row.created_at),
      }));

      return { ok: true, value: events };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get lifecycle history',
          cause: error,
        },
      };
    }
  }

  /**
   * Get recent transitions for a workspace
   */
  async getRecentTransitions(
    workspaceId: string,
    limit: number = 100
  ): Promise<Result<LifecycleEvent[], StorageError>> {
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

    try {
      const result = await this.adapter.query<any>(
        'SELECT * FROM lifecycle_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
        [workspaceId, limit]
      );

      if (!result.ok) {
        return result;
      }

      // Parse metadata from JSON string
      const events: LifecycleEvent[] = result.value.map((row: any) => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        created_at: new Date(row.created_at),
      }));

      return { ok: true, value: events };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get recent transitions',
          cause: error,
        },
      };
    }
  }
}
