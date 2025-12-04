/**
 * Memory ranking utilities for Context Engine
 */

import type { SearchResult, RankingOptions } from './types';

/**
 * MemoryRanker provides various ranking strategies for search results
 */
export class MemoryRanker {
  /**
   * Default ranking that combines similarity, recency, and confidence
   * 
   * Formula: rank_score = (similarity * similarityWeight) + 
   *                       (recency_score * recencyWeight) + 
   *                       (confidence * confidenceWeight)
   * 
   * Where recency_score = 1 / (1 + days_since_creation)
   */
  static defaultRanking(
    results: SearchResult[],
    options: RankingOptions = {}
  ): SearchResult[] {
    // Handle empty or invalid results
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }

    const {
      similarityWeight = 0.4,
      recencyWeight = 0.2,
      confidenceWeight = 0.2,
      decayWeight = 0.2,
    } = options;

    // Validate weights are non-negative
    const validSimilarityWeight = Math.max(0, similarityWeight);
    const validRecencyWeight = Math.max(0, recencyWeight);
    const validConfidenceWeight = Math.max(0, confidenceWeight);
    const validDecayWeight = Math.max(0, decayWeight);

    // Calculate rank scores for each result
    const rankedResults = results
      .filter(result => result && result.memory) // Filter out invalid results
      .map((result) => {
        try {
          const similarity = Number.isFinite(result.score) ? result.score : 0;
          const recencyScore = this.calculateRecencyScore(result.memory.created_at);
          const confidence = Number.isFinite(result.memory.confidence)
            ? result.memory.confidence
            : 0.5;

          // Use decay_score if available, otherwise default to 1.0 (fresh)
          const decayScore = Number.isFinite(result.memory.decay_score)
            ? result.memory.decay_score
            : 1.0;

          const rankScore =
            similarity * validSimilarityWeight +
            recencyScore * validRecencyWeight +
            confidence * validConfidenceWeight +
            decayScore * validDecayWeight;

          return {
            ...result,
            rank: Number.isFinite(rankScore) ? rankScore : 0,
          };
        } catch (error) {
          // If ranking fails for a result, assign it a rank of 0
          return {
            ...result,
            rank: 0,
          };
        }
      });

    // Sort by rank score (highest first)
    return rankedResults.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  }

  /**
   * Rank by similarity score only
   */
  static bySimilarity(results: SearchResult[]): SearchResult[] {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }

    return results
      .filter(result => result && result.memory)
      .map((result) => ({
        ...result,
        rank: Number.isFinite(result.score) ? result.score : 0,
      }))
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  }

  /**
   * Rank by recency only (most recent first)
   */
  static byRecency(results: SearchResult[]): SearchResult[] {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }

    return results
      .filter(result => result && result.memory && result.memory.created_at)
      .map((result) => {
        try {
          return {
            ...result,
            rank: this.calculateRecencyScore(result.memory.created_at),
          };
        } catch (error) {
          return {
            ...result,
            rank: 0,
          };
        }
      })
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  }

  /**
   * Rank by confidence only (highest confidence first)
   */
  static byConfidence(results: SearchResult[]): SearchResult[] {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }

    return results
      .filter(result => result && result.memory)
      .map((result) => {
        const confidence = result.memory.confidence ?? 0.5;
        return {
          ...result,
          rank: Number.isFinite(confidence) ? confidence : 0.5,
        };
      })
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  }

  /**
   * Custom ranking function that accepts a custom score function
   */
  static custom(
    results: SearchResult[],
    scoreFn: (result: SearchResult) => number
  ): SearchResult[] {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }

    if (typeof scoreFn !== 'function') {
      throw new Error('scoreFn must be a function');
    }

    return results
      .filter(result => result && result.memory)
      .map((result) => {
        try {
          const score = scoreFn(result);
          return {
            ...result,
            rank: Number.isFinite(score) ? score : 0,
          };
        } catch (error) {
          // If custom scoring fails, assign rank of 0
          return {
            ...result,
            rank: 0,
          };
        }
      })
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  }

  /**
   * Calculate recency score based on creation date
   * Formula: 1 / (1 + days_since_creation)
   */
  private static calculateRecencyScore(createdAt: Date | string): number {
    try {
      const createdDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;

      // Validate date
      if (!createdDate || isNaN(createdDate.getTime())) {
        return 0.5; // Default recency score for invalid dates
      }

      const now = new Date();
      const daysSinceCreation = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      // Handle negative days (future dates) or invalid calculations
      if (!Number.isFinite(daysSinceCreation) || daysSinceCreation < 0) {
        return 0.5;
      }

      const score = 1 / (1 + daysSinceCreation);

      // Ensure score is valid
      return Number.isFinite(score) ? score : 0.5;
    } catch (error) {
      return 0.5; // Default recency score on error
    }
  }
}
