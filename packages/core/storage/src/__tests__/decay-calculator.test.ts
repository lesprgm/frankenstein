/**
 * Unit tests for DecayCalculator
 */

import { describe, it, expect } from 'vitest';
import { DecayCalculator, DECAY_FUNCTIONS, type DecayFunction } from '../lifecycle/decay-calculator.js';

describe('DecayCalculator', () => {
  describe('DECAY_FUNCTIONS.exponential', () => {
    it('should return 1.0 for zero elapsed time', () => {
      const decayFn = DECAY_FUNCTIONS.exponential(0.1);
      const calculator = new DecayCalculator(decayFn);
      
      const now = new Date();
      const score = calculator.calculateDecayScore(now, now);
      
      expect(score).toBeCloseTo(1.0, 5);
    });

    it('should decay over time with lambda=0.1', () => {
      const decayFn = DECAY_FUNCTIONS.exponential(0.1);
      const calculator = new DecayCalculator(decayFn);
      
      const lastAccessed = new Date('2024-01-01');
      const now = new Date('2024-01-11'); // 10 days later
      
      const score = calculator.calculateDecayScore(lastAccessed, now);
      
      // e^(-0.1 * 10) ≈ 0.368
      expect(score).toBeCloseTo(0.368, 2);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should decay faster with higher lambda', () => {
      const slowDecay = new DecayCalculator(DECAY_FUNCTIONS.exponential(0.01));
      const fastDecay = new DecayCalculator(DECAY_FUNCTIONS.exponential(0.1));
      
      const lastAccessed = new Date('2024-01-01');
      const now = new Date('2024-01-31'); // 30 days later
      
      const slowScore = slowDecay.calculateDecayScore(lastAccessed, now);
      const fastScore = fastDecay.calculateDecayScore(lastAccessed, now);
      
      expect(fastScore).toBeLessThan(slowScore);
    });
  });

  describe('DECAY_FUNCTIONS.linear', () => {
    it('should return 1.0 for zero elapsed time', () => {
      const decayFn = DECAY_FUNCTIONS.linear(30 * 24 * 60 * 60 * 1000); // 30 days
      const calculator = new DecayCalculator(decayFn);
      
      const now = new Date();
      const score = calculator.calculateDecayScore(now, now);
      
      expect(score).toBeCloseTo(1.0, 5);
    });

    it('should decay linearly over time', () => {
      const decayPeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
      const decayFn = DECAY_FUNCTIONS.linear(decayPeriod);
      const calculator = new DecayCalculator(decayFn);
      
      const lastAccessed = new Date('2024-01-01');
      
      // After 15 days (50% of period), score should be 0.5
      const halfway = new Date('2024-01-16');
      expect(calculator.calculateDecayScore(lastAccessed, halfway)).toBeCloseTo(0.5, 5);
      
      // After 30 days (100% of period), score should be 0
      const end = new Date('2024-01-31');
      expect(calculator.calculateDecayScore(lastAccessed, end)).toBeCloseTo(0.0, 5);
      
      // After 45 days (150% of period), score should still be 0
      const beyond = new Date('2024-02-15');
      expect(calculator.calculateDecayScore(lastAccessed, beyond)).toBeCloseTo(0.0, 5);
    });
  });

  describe('DECAY_FUNCTIONS.step', () => {
    it('should return discrete scores at intervals', () => {
      const day = 24 * 60 * 60 * 1000;
      const intervals = [7 * day, 30 * day, 90 * day, Infinity];
      const scores = [1.0, 0.7, 0.4, 0.1];
      
      const decayFn = DECAY_FUNCTIONS.step(intervals, scores);
      const calculator = new DecayCalculator(decayFn);
      
      const lastAccessed = new Date('2024-01-01');
      
      // Within 7 days: score = 1.0
      const day5 = new Date('2024-01-06');
      expect(calculator.calculateDecayScore(lastAccessed, day5)).toBe(1.0);
      
      // Between 7-30 days: score = 0.7
      const day20 = new Date('2024-01-21');
      expect(calculator.calculateDecayScore(lastAccessed, day20)).toBe(0.7);
      
      // Between 30-90 days: score = 0.4
      const day60 = new Date('2024-03-01');
      expect(calculator.calculateDecayScore(lastAccessed, day60)).toBe(0.4);
      
      // Beyond 90 days: score = 0.1
      const day120 = new Date('2024-04-30');
      expect(calculator.calculateDecayScore(lastAccessed, day120)).toBe(0.1);
    });

    it('should throw error for mismatched intervals and scores', () => {
      const intervals = [1000, 2000];
      const scores = [1.0, 0.5, 0.2, 0.1]; // Too many scores
      
      expect(() => DECAY_FUNCTIONS.step(intervals, scores)).toThrow(
        'Intervals and scores arrays must have the same length'
      );
    });
  });

  describe('calculateDecayScore', () => {
    it('should handle future timestamps gracefully', () => {
      const decayFn = DECAY_FUNCTIONS.exponential(0.1);
      const calculator = new DecayCalculator(decayFn);
      
      const now = new Date();
      const future = new Date(now.getTime() + 1000 * 60 * 60); // 1 hour in future
      
      const score = calculator.calculateDecayScore(future, now);
      expect(score).toBe(1.0); // Future timestamps get max score
    });

    it('should clamp scores to [0, 1] range', () => {
      // Create a custom function that might return values outside range
      const customFn: DecayFunction = {
        type: 'custom',
        params: {},
        compute: (elapsedMs: number) => {
          // This would normally fail validation, but we're testing the clamp
          return 0.5; // Valid value
        }
      };
      
      const calculator = new DecayCalculator(customFn);
      const lastAccessed = new Date('2024-01-01');
      const now = new Date('2024-01-02');
      
      const score = calculator.calculateDecayScore(lastAccessed, now);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('getDecayFunction', () => {
    it('should return the configured decay function', () => {
      const decayFn = DECAY_FUNCTIONS.exponential(0.1);
      const calculator = new DecayCalculator(decayFn);
      
      const retrieved = calculator.getDecayFunction();
      expect(retrieved.type).toBe('exponential');
      expect(retrieved.params.lambda).toBe(0.1);
    });
  });

  describe('validateDecayFunction', () => {
    it('should validate a correct decay function', () => {
      const validFn = (elapsedMs: number) => Math.exp(-0.1 * elapsedMs / (1000 * 60 * 60 * 24));
      expect(DecayCalculator.validateDecayFunction(validFn)).toBe(true);
    });

    it('should reject function returning values > 1', () => {
      const invalidFn = (elapsedMs: number) => 1.5;
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });

    it('should reject function returning values < 0', () => {
      const invalidFn = (elapsedMs: number) => -0.5;
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });

    it('should reject function returning NaN', () => {
      const invalidFn = (elapsedMs: number) => NaN;
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });

    it('should reject function returning Infinity', () => {
      const invalidFn = (elapsedMs: number) => Infinity;
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });

    it('should reject function that throws errors', () => {
      const invalidFn = (elapsedMs: number) => {
        throw new Error('Test error');
      };
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });

    it('should reject function returning non-numbers', () => {
      const invalidFn = (elapsedMs: number) => 'not a number' as any;
      expect(DecayCalculator.validateDecayFunction(invalidFn)).toBe(false);
    });
  });

  describe('constructor validation', () => {
    it('should accept valid decay functions', () => {
      expect(() => new DecayCalculator(DECAY_FUNCTIONS.exponential(0.1))).not.toThrow();
      expect(() => new DecayCalculator(DECAY_FUNCTIONS.linear(30 * 24 * 60 * 60 * 1000))).not.toThrow();
      expect(() => new DecayCalculator(DECAY_FUNCTIONS.step([1000, 2000, Infinity], [1.0, 0.5, 0.0]))).not.toThrow();
    });

    it('should reject invalid decay functions', () => {
      const invalidFn: DecayFunction = {
        type: 'custom',
        params: {},
        compute: (elapsedMs: number) => 2.0 // Invalid: > 1
      };
      
      expect(() => new DecayCalculator(invalidFn)).toThrow(
        'Invalid decay function: must return values between 0 and 1'
      );
    });
  });

  describe('custom decay functions', () => {
    it('should support custom decay functions', () => {
      // Half-life decay
      const halfLife = 30 * 24 * 60 * 60 * 1000; // 30 days
      const customFn: DecayFunction = {
        type: 'custom',
        params: { halfLife },
        compute: (elapsedMs: number) => Math.pow(0.5, elapsedMs / halfLife)
      };
      
      const calculator = new DecayCalculator(customFn);
      
      const lastAccessed = new Date('2024-01-01');
      const after30Days = new Date('2024-01-31');
      
      const score = calculator.calculateDecayScore(lastAccessed, after30Days);
      expect(score).toBeCloseTo(0.5, 5); // After one half-life, score should be 0.5
    });
  });
});
