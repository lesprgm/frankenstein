/**
 * State Machine Validation - Validates lifecycle state transitions
 */

import { LifecycleState } from '../models.js';
import { Result, StorageError } from '../errors.js';

/**
 * Valid state transitions as defined in the requirements
 */
const VALID_TRANSITIONS: Map<LifecycleState, LifecycleState[]> = new Map([
  ['active', ['decaying', 'archived', 'pinned']],
  ['decaying', ['archived', 'active', 'pinned']],
  ['archived', ['active', 'expired', 'pinned']],
  ['expired', ['pinned']], // Can only be pinned to prevent deletion
  ['pinned', ['active', 'decaying', 'archived', 'expired']], // Can return to any previous state
]);

/**
 * State transition context for validation
 */
export interface TransitionContext {
  fromState: LifecycleState;
  toState: LifecycleState;
  isPinned: boolean;
  triggeredBy: 'system' | 'user';
  reason?: string;
}

/**
 * Result of state transition validation
 */
export interface TransitionValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a lifecycle state transition
 */
export function validateTransition(context: TransitionContext): Result<TransitionValidation, StorageError> {
  const { fromState, toState, isPinned, triggeredBy } = context;

  // Same state transition is always valid (no-op)
  if (fromState === toState) {
    return {
      ok: true,
      value: {
        valid: true,
        reason: 'No state change',
      },
    };
  }

  // Check if transition to pinned state
  if (toState === 'pinned') {
    // Can always transition to pinned from any state
    return {
      ok: true,
      value: {
        valid: true,
        reason: generateTransitionReason(context),
      },
    };
  }

  // Guard: Pinned memories cannot be automatically transitioned by system
  // This must be checked before the "fromState === 'pinned'" check to prevent
  // system from unpinning or archiving pinned memories
  if (isPinned && triggeredBy === 'system') {
    return {
      ok: true,
      value: {
        valid: false,
        reason: 'Pinned memories are immune to automatic lifecycle transitions',
      },
    };
  }

  // Check if transitioning from pinned state
  if (fromState === 'pinned') {
    // Can transition from pinned to any state (unpinning)
    return {
      ok: true,
      value: {
        valid: true,
        reason: generateTransitionReason(context),
      },
    };
  }

  // Check if transition is in the valid transitions map
  const validNextStates = VALID_TRANSITIONS.get(fromState);
  if (!validNextStates) {
    return {
      ok: false,
      error: {
        type: 'validation',
        field: 'fromState',
        message: `Unknown lifecycle state: ${fromState}`,
      },
    };
  }

  if (!validNextStates.includes(toState)) {
    return {
      ok: true,
      value: {
        valid: false,
        reason: `Invalid transition from ${fromState} to ${toState}`,
      },
    };
  }

  // Transition is valid
  return {
    ok: true,
    value: {
      valid: true,
      reason: generateTransitionReason(context),
    },
  };
}

/**
 * Generate a human-readable reason for a state transition
 */
export function generateTransitionReason(context: TransitionContext): string {
  const { fromState, toState, triggeredBy, reason } = context;

  // If a custom reason is provided, use it
  if (reason && reason.trim()) {
    return reason.trim();
  }

  // Generate default reasons based on transition type
  if (toState === 'pinned') {
    return triggeredBy === 'user'
      ? 'Memory pinned by user'
      : 'Memory pinned by system';
  }

  if (fromState === 'pinned') {
    return triggeredBy === 'user'
      ? 'Memory unpinned by user'
      : 'Memory unpinned by system';
  }

  // Generate reasons for common transitions
  const transitionReasons: Record<string, string> = {
    'active->decaying': 'Decay score fell below threshold',
    'active->archived': 'TTL expired without access',
    'decaying->archived': 'TTL expired in decaying state',
    'decaying->active': 'Memory accessed, restored to active state',
    'archived->active': 'Archived memory accessed and restored',
    'archived->expired': 'Archive retention period expired',
    'expired->pinned': 'Expired memory pinned to prevent deletion',
  };

  const key = `${fromState}->${toState}`;
  return transitionReasons[key] || `Transitioned from ${fromState} to ${toState}`;
}

/**
 * Get all valid next states for a given state
 */
export function getValidNextStates(state: LifecycleState): LifecycleState[] {
  return VALID_TRANSITIONS.get(state) || [];
}

/**
 * Check if a transition is valid (simplified version without context)
 */
export function isValidTransition(fromState: LifecycleState, toState: LifecycleState): boolean {
  // Same state is always valid
  if (fromState === toState) {
    return true;
  }

  // Can always transition to/from pinned
  if (toState === 'pinned' || fromState === 'pinned') {
    return true;
  }

  const validNextStates = VALID_TRANSITIONS.get(fromState);
  return validNextStates ? validNextStates.includes(toState) : false;
}
