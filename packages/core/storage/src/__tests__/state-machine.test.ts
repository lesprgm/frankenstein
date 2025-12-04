/**
 * Unit tests for State Machine Validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  generateTransitionReason,
  getValidNextStates,
  isValidTransition,
  type TransitionContext,
} from '../lifecycle/state-machine.js';
import { LifecycleState } from '../models.js';

describe('State Machine', () => {
  describe('validateTransition', () => {
    describe('valid transitions', () => {
      it('should allow active -> decaying', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'decaying',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow active -> archived', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'archived',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow decaying -> archived', () => {
        const context: TransitionContext = {
          fromState: 'decaying',
          toState: 'archived',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow decaying -> active', () => {
        const context: TransitionContext = {
          fromState: 'decaying',
          toState: 'active',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow archived -> active', () => {
        const context: TransitionContext = {
          fromState: 'archived',
          toState: 'active',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow archived -> expired', () => {
        const context: TransitionContext = {
          fromState: 'archived',
          toState: 'expired',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow any state -> pinned', () => {
        const states: LifecycleState[] = ['active', 'decaying', 'archived', 'expired'];

        states.forEach(state => {
          const context: TransitionContext = {
            fromState: state,
            toState: 'pinned',
            isPinned: false,
            triggeredBy: 'user',
          };

          const result = validateTransition(context);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.valid).toBe(true);
          }
        });
      });

      it('should allow pinned -> any state', () => {
        const states: LifecycleState[] = ['active', 'decaying', 'archived', 'expired'];

        states.forEach(state => {
          const context: TransitionContext = {
            fromState: 'pinned',
            toState: state,
            isPinned: true,
            triggeredBy: 'user',
          };

          const result = validateTransition(context);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.valid).toBe(true);
          }
        });
      });
    });

    describe('invalid transitions', () => {
      it('should reject active -> expired', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'expired',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(false);
          expect(result.value.reason).toContain('Invalid transition');
        }
      });

      it('should reject decaying -> expired', () => {
        const context: TransitionContext = {
          fromState: 'decaying',
          toState: 'expired',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(false);
        }
      });

      it('should reject expired -> active', () => {
        const context: TransitionContext = {
          fromState: 'expired',
          toState: 'active',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(false);
        }
      });

      it('should reject expired -> archived', () => {
        const context: TransitionContext = {
          fromState: 'expired',
          toState: 'archived',
          isPinned: false,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(false);
        }
      });
    });

    describe('pinned memory guards', () => {
      it('should block system transitions for pinned memories', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'decaying',
          isPinned: true,
          triggeredBy: 'system',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(false);
          expect(result.value.reason).toContain('Pinned memories are immune');
        }
      });

      it('should allow user transitions for pinned memories', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'archived',
          isPinned: true,
          triggeredBy: 'user',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow pinning a memory', () => {
        const context: TransitionContext = {
          fromState: 'active',
          toState: 'pinned',
          isPinned: false,
          triggeredBy: 'user',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });

      it('should allow unpinning a memory', () => {
        const context: TransitionContext = {
          fromState: 'pinned',
          toState: 'active',
          isPinned: true,
          triggeredBy: 'user',
        };

        const result = validateTransition(context);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.valid).toBe(true);
        }
      });
    });

    describe('same state transitions', () => {
      it('should allow same state transitions (no-op)', () => {
        const states: LifecycleState[] = ['active', 'decaying', 'archived', 'expired', 'pinned'];

        states.forEach(state => {
          const context: TransitionContext = {
            fromState: state,
            toState: state,
            isPinned: false,
            triggeredBy: 'system',
          };

          const result = validateTransition(context);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.valid).toBe(true);
            expect(result.value.reason).toBe('No state change');
          }
        });
      });
    });
  });

  describe('generateTransitionReason', () => {
    it('should use custom reason when provided', () => {
      const context: TransitionContext = {
        fromState: 'active',
        toState: 'decaying',
        isPinned: false,
        triggeredBy: 'system',
        reason: 'Custom reason for transition',
      };

      const reason = generateTransitionReason(context);
      expect(reason).toBe('Custom reason for transition');
    });

    it('should generate reason for pinning', () => {
      const userContext: TransitionContext = {
        fromState: 'active',
        toState: 'pinned',
        isPinned: false,
        triggeredBy: 'user',
      };

      expect(generateTransitionReason(userContext)).toBe('Memory pinned by user');

      const systemContext: TransitionContext = {
        fromState: 'active',
        toState: 'pinned',
        isPinned: false,
        triggeredBy: 'system',
      };

      expect(generateTransitionReason(systemContext)).toBe('Memory pinned by system');
    });

    it('should generate reason for unpinning', () => {
      const userContext: TransitionContext = {
        fromState: 'pinned',
        toState: 'active',
        isPinned: true,
        triggeredBy: 'user',
      };

      expect(generateTransitionReason(userContext)).toBe('Memory unpinned by user');

      const systemContext: TransitionContext = {
        fromState: 'pinned',
        toState: 'active',
        isPinned: true,
        triggeredBy: 'system',
      };

      expect(generateTransitionReason(systemContext)).toBe('Memory unpinned by system');
    });

    it('should generate default reasons for common transitions', () => {
      const transitions = [
        { from: 'active', to: 'decaying', expected: 'Decay score fell below threshold' },
        { from: 'active', to: 'archived', expected: 'TTL expired without access' },
        { from: 'decaying', to: 'archived', expected: 'TTL expired in decaying state' },
        { from: 'decaying', to: 'active', expected: 'Memory accessed, restored to active state' },
        { from: 'archived', to: 'active', expected: 'Archived memory accessed and restored' },
        { from: 'archived', to: 'expired', expected: 'Archive retention period expired' },
      ];

      transitions.forEach(({ from, to, expected }) => {
        const context: TransitionContext = {
          fromState: from as LifecycleState,
          toState: to as LifecycleState,
          isPinned: false,
          triggeredBy: 'system',
        };

        expect(generateTransitionReason(context)).toBe(expected);
      });
    });

    it('should generate generic reason for uncommon transitions', () => {
      const context: TransitionContext = {
        fromState: 'expired',
        toState: 'pinned',
        isPinned: false,
        triggeredBy: 'user',
      };

      const reason = generateTransitionReason(context);
      // Transition to pinned has a specific reason
      expect(reason).toBe('Memory pinned by user');
    });
  });

  describe('getValidNextStates', () => {
    it('should return valid next states for active', () => {
      const nextStates = getValidNextStates('active');
      expect(nextStates).toContain('decaying');
      expect(nextStates).toContain('archived');
      expect(nextStates).toContain('pinned');
      expect(nextStates).not.toContain('expired');
    });

    it('should return valid next states for decaying', () => {
      const nextStates = getValidNextStates('decaying');
      expect(nextStates).toContain('archived');
      expect(nextStates).toContain('active');
      expect(nextStates).toContain('pinned');
      expect(nextStates).not.toContain('expired');
    });

    it('should return valid next states for archived', () => {
      const nextStates = getValidNextStates('archived');
      expect(nextStates).toContain('active');
      expect(nextStates).toContain('expired');
      expect(nextStates).toContain('pinned');
      expect(nextStates).not.toContain('decaying');
    });

    it('should return valid next states for expired', () => {
      const nextStates = getValidNextStates('expired');
      expect(nextStates).toContain('pinned');
      expect(nextStates).not.toContain('active');
      expect(nextStates).not.toContain('archived');
    });

    it('should return valid next states for pinned', () => {
      const nextStates = getValidNextStates('pinned');
      expect(nextStates).toContain('active');
      expect(nextStates).toContain('decaying');
      expect(nextStates).toContain('archived');
      expect(nextStates).toContain('expired');
    });
  });

  describe('isValidTransition', () => {
    it('should return true for valid transitions', () => {
      expect(isValidTransition('active', 'decaying')).toBe(true);
      expect(isValidTransition('active', 'archived')).toBe(true);
      expect(isValidTransition('decaying', 'archived')).toBe(true);
      expect(isValidTransition('archived', 'active')).toBe(true);
      expect(isValidTransition('archived', 'expired')).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(isValidTransition('active', 'expired')).toBe(false);
      expect(isValidTransition('decaying', 'expired')).toBe(false);
      expect(isValidTransition('expired', 'active')).toBe(false);
      expect(isValidTransition('expired', 'archived')).toBe(false);
    });

    it('should return true for same state transitions', () => {
      expect(isValidTransition('active', 'active')).toBe(true);
      expect(isValidTransition('decaying', 'decaying')).toBe(true);
      expect(isValidTransition('archived', 'archived')).toBe(true);
    });

    it('should return true for transitions to/from pinned', () => {
      expect(isValidTransition('active', 'pinned')).toBe(true);
      expect(isValidTransition('decaying', 'pinned')).toBe(true);
      expect(isValidTransition('archived', 'pinned')).toBe(true);
      expect(isValidTransition('expired', 'pinned')).toBe(true);
      expect(isValidTransition('pinned', 'active')).toBe(true);
      expect(isValidTransition('pinned', 'decaying')).toBe(true);
      expect(isValidTransition('pinned', 'archived')).toBe(true);
      expect(isValidTransition('pinned', 'expired')).toBe(true);
    });
  });
});
