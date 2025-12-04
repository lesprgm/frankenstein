/**
 * Decay Calculator - Computes time-based decay scores using configurable functions
 */

/**
 * Decay function types supported by the system
 */
export type DecayFunctionType = 'exponential' | 'linear' | 'step' | 'custom';

/**
 * Decay function interface
 */
export interface DecayFunction {
  type: DecayFunctionType;
  params: Record<string, any>;
  compute: (elapsedMs: number) => number; // returns 0-1
}

/**
 * Built-in decay function factories
 */
export const DECAY_FUNCTIONS = {
  /**
   * Exponential decay: score = e^(-λt)
   * @param lambda - Decay rate (higher = faster decay)
   */
  exponential: (lambda: number): DecayFunction => ({
    type: 'exponential',
    params: { lambda },
    compute: (elapsedMs: number) => {
      const days = elapsedMs / (1000 * 60 * 60 * 24);
      return Math.exp(-lambda * days);
    }
  }),

  /**
   * Linear decay: score = max(0, 1 - (t / T))
   * @param decayPeriodMs - Time period for full decay (milliseconds)
   */
  linear: (decayPeriodMs: number): DecayFunction => ({
    type: 'linear',
    params: { decayPeriodMs },
    compute: (elapsedMs: number) => {
      return Math.max(0, 1 - (elapsedMs / decayPeriodMs));
    }
  }),

  /**
   * Step decay: discrete score reductions at intervals
   * @param intervals - Time intervals in milliseconds
   * @param scores - Corresponding scores for each interval
   */
  step: (intervals: number[], scores: number[]): DecayFunction => {
    if (intervals.length !== scores.length) {
      throw new Error('Intervals and scores arrays must have the same length');
    }
    return {
      type: 'step',
      params: { intervals, scores },
      compute: (elapsedMs: number) => {
        for (let i = 0; i < intervals.length; i++) {
          if (elapsedMs < intervals[i]) {
            return scores[i];
          }
        }
        return scores[scores.length - 1];
      }
    };
  }
};

/**
 * DecayCalculator - Calculates time-based decay scores for memories
 */
export class DecayCalculator {
  private decayFunction: DecayFunction;

  constructor(decayFunction: DecayFunction) {
    // Validate the decay function
    if (!DecayCalculator.validateDecayFunction(decayFunction.compute)) {
      throw new Error('Invalid decay function: must return values between 0 and 1');
    }
    this.decayFunction = decayFunction;
  }

  /**
   * Calculate decay score based on time elapsed since last access
   * @param lastAccessedAt - Timestamp of last access
   * @param now - Current timestamp (defaults to current time)
   * @returns Decay score between 0 and 1
   */
  calculateDecayScore(lastAccessedAt: Date, now: Date = new Date()): number {
    const elapsedMs = now.getTime() - lastAccessedAt.getTime();

    // Handle invalid dates
    if (isNaN(elapsedMs)) {
      return 1.0; // Fail safe to fresh
    }

    // Ensure elapsed time is non-negative
    if (elapsedMs < 0) {
      return 1.0; // Future timestamps get max score
    }

    const score = this.decayFunction.compute(elapsedMs);

    // Clamp to [0, 1] range as a safety measure
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get the current decay function configuration
   */
  getDecayFunction(): DecayFunction {
    return this.decayFunction;
  }

  /**
   * Validate a decay function
   * Tests the function with various inputs to ensure it returns values in [0, 1]
   * @param fn - Decay function to validate
   * @returns true if valid, false otherwise
   */
  static validateDecayFunction(fn: (elapsedMs: number) => number): boolean {
    try {
      // Test with various elapsed times
      const testValues = [
        0,                          // Just created
        1000 * 60,                  // 1 minute
        1000 * 60 * 60,             // 1 hour
        1000 * 60 * 60 * 24,        // 1 day
        1000 * 60 * 60 * 24 * 7,    // 1 week
        1000 * 60 * 60 * 24 * 30,   // 1 month
        1000 * 60 * 60 * 24 * 365   // 1 year
      ];

      for (const elapsed of testValues) {
        const result = fn(elapsed);

        // Check if result is a valid number
        if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
          return false;
        }

        // Check if result is in [0, 1] range
        if (result < 0 || result > 1) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
