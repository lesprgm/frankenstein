/**
 * Unit tests for ImportanceScorer
 */

import { describe, it, expect } from 'vitest';
import { ImportanceScorer, type AccessMetrics, type ImportanceWeights } from '../lifecycle/importance-scorer.js';

describe('ImportanceScorer', () => {
  const defaultWeights: ImportanceWeights = {
    accessFrequency: 0.5,
    confidence: 0.3,
    relationshipCount: 0.2
  };

  describe('constructor', () => {
    it('should create scorer with valid weights', () => {
      expect(() => new ImportanceScorer(defaultWeights)).not.toThrow();
    });

    it('should reject weights outside [0, 1] range', () => {
      const invalidWeights: ImportanceWeights = {
        accessFrequency: 1.5, // Invalid: > 1
        confidence: 0.3,
        relationshipCount: 0.2
      };
      
      expect(() => new ImportanceScorer(invalidWeights)).toThrow(
        'All importance weights must be between 0 and 1'
      );
    });

    it('should reject negative weights', () => {
      const invalidWeights: ImportanceWeights = {
        accessFrequency: -0.1, // Invalid: < 0
        confidence: 0.3,
        relationshipCount: 0.2
      };
      
      expect(() => new ImportanceScorer(invalidWeights)).toThrow(
        'All importance weights must be between 0 and 1'
      );
    });

    it('should reject weights that sum outside [0.5, 1.5] range', () => {
      const invalidWeights: ImportanceWeights = {
        accessFrequency: 0.1,
        confidence: 0.1,
        relationshipCount: 0.1 // Sum = 0.3, too low
      };
      
      expect(() => new ImportanceScorer(invalidWeights)).toThrow(
        'Sum of importance weights must be between 0.5 and 1.5'
      );
    });

    it('should reject non-numeric weights', () => {
      const invalidWeights: any = {
        accessFrequency: 'not a number',
        confidence: 0.3,
        relationshipCount: 0.2
      };
      
      expect(() => new ImportanceScorer(invalidWeights)).toThrow(
        'All importance weights must be numbers'
      );
    });
  });

  describe('calculateImportance', () => {
    it('should calculate importance for a frequently accessed memory', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 100,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        relationship_count: 10,
        confidence: 0.9
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThan(0);
      expect(importance).toBeLessThanOrEqual(1);
      expect(importance).toBeGreaterThan(0.5); // Should be high importance
    });

    it('should calculate importance for a rarely accessed memory', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 1,
        last_accessed_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        relationship_count: 0,
        confidence: 0.3
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThan(1);
      expect(importance).toBeLessThan(0.5); // Should be low importance
    });

    it('should return value between 0 and 1', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      // Test with extreme values
      const extremeMetrics: AccessMetrics = {
        access_count: 10000,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        relationship_count: 100,
        confidence: 1.0
      };
      
      const importance = scorer.calculateImportance(extremeMetrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });

    it('should handle zero access count', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 0,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        relationship_count: 0,
        confidence: 0.5
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });

    it('should handle very new memories (less than 1 day old)', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        relationship_count: 2,
        confidence: 0.8
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });

    it('should weight access frequency appropriately', () => {
      const highFrequencyWeight: ImportanceWeights = {
        accessFrequency: 0.9,
        confidence: 0.05,
        relationshipCount: 0.05
      };
      
      const scorer = new ImportanceScorer(highFrequencyWeight);
      
      const highAccessMetrics: AccessMetrics = {
        access_count: 100,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        relationship_count: 0,
        confidence: 0.1
      };
      
      const lowAccessMetrics: AccessMetrics = {
        access_count: 1,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        relationship_count: 0,
        confidence: 0.1
      };
      
      const highImportance = scorer.calculateImportance(highAccessMetrics);
      const lowImportance = scorer.calculateImportance(lowAccessMetrics);
      
      expect(highImportance).toBeGreaterThan(lowImportance);
    });

    it('should weight confidence appropriately', () => {
      const highConfidenceWeight: ImportanceWeights = {
        accessFrequency: 0.1,
        confidence: 0.8,
        relationshipCount: 0.1
      };
      
      const scorer = new ImportanceScorer(highConfidenceWeight);
      
      const highConfidenceMetrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        relationship_count: 2,
        confidence: 0.95
      };
      
      const lowConfidenceMetrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        relationship_count: 2,
        confidence: 0.2
      };
      
      const highImportance = scorer.calculateImportance(highConfidenceMetrics);
      const lowImportance = scorer.calculateImportance(lowConfidenceMetrics);
      
      expect(highImportance).toBeGreaterThan(lowImportance);
    });

    it('should weight relationship count appropriately', () => {
      const highRelationshipWeight: ImportanceWeights = {
        accessFrequency: 0.1,
        confidence: 0.1,
        relationshipCount: 0.8
      };
      
      const scorer = new ImportanceScorer(highRelationshipWeight);
      
      const highRelationshipMetrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        relationship_count: 20,
        confidence: 0.5
      };
      
      const lowRelationshipMetrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        relationship_count: 0,
        confidence: 0.5
      };
      
      const highImportance = scorer.calculateImportance(highRelationshipMetrics);
      const lowImportance = scorer.calculateImportance(lowRelationshipMetrics);
      
      expect(highImportance).toBeGreaterThan(lowImportance);
    });
  });

  describe('getWeights', () => {
    it('should return a copy of the weights', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      const weights = scorer.getWeights();
      
      expect(weights).toEqual(defaultWeights);
      
      // Verify it's a copy, not a reference
      weights.accessFrequency = 0.9;
      expect(scorer.getWeights().accessFrequency).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('should handle memory created in the future', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 5,
        last_accessed_at: new Date(),
        created_at: new Date(Date.now() + 1000 * 60 * 60), // 1 hour in future
        relationship_count: 2,
        confidence: 0.8
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });

    it('should handle all zero metrics', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: 0,
        last_accessed_at: new Date(),
        created_at: new Date(),
        relationship_count: 0,
        confidence: 0
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });

    it('should handle all maximum metrics', () => {
      const scorer = new ImportanceScorer(defaultWeights);
      
      const metrics: AccessMetrics = {
        access_count: Number.MAX_SAFE_INTEGER,
        last_accessed_at: new Date(),
        created_at: new Date(0), // Very old
        relationship_count: Number.MAX_SAFE_INTEGER,
        confidence: 1.0
      };
      
      const importance = scorer.calculateImportance(metrics);
      
      expect(importance).toBeGreaterThanOrEqual(0);
      expect(importance).toBeLessThanOrEqual(1);
    });
  });
});
