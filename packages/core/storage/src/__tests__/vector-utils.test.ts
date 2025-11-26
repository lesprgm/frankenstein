/**
 * Unit tests for vector utilities
 */

import { describe, it, expect } from 'vitest';
import {
    cosineSimilarity,
    euclideanDistance,
    normalizeVector,
    dotProduct,
    findTopKSimilar,
    batchCosineSimilarity,
    isNormalized,
} from '../vector-utils.js';

describe('Vector Utils', () => {
    describe('cosineSimilarity', () => {
        it('should return 1 for identical vectors', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2, 3];
            expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
        });

        it('should return 0 for orthogonal vectors', () => {
            const v1 = [1, 0, 0];
            const v2 = [0, 1, 0];
            expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
        });

        it('should return -1 for opposite vectors', () => {
            const v1 = [1, 2, 3];
            const v2 = [-1, -2, -3];
            expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
        });

        it('should handle normalized vectors', () => {
            const v1 = [0.6, 0.8];
            const v2 = [0.8, 0.6];
            const similarity = cosineSimilarity(v1, v2);
            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThan(1);
        });

        it('should throw error for mismatched dimensions', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2];
            expect(() => cosineSimilarity(v1, v2)).toThrow('Vector dimension mismatch');
        });

        it('should handle zero vectors', () => {
            const v1 = [0, 0, 0];
            const v2 = [1, 2, 3];
            expect(cosineSimilarity(v1, v2)).toBe(0);
        });

        it('should work with embedding-sized vectors', () => {
            // Simulate 384-dimensional embeddings
            const v1 = new Array(384).fill(0).map(() => Math.random());
            const v2 = new Array(384).fill(0).map(() => Math.random());
            const similarity = cosineSimilarity(v1, v2);
            expect(similarity).toBeGreaterThanOrEqual(-1);
            expect(similarity).toBeLessThanOrEqual(1);
        });
    });

    describe('euclideanDistance', () => {
        it('should return 0 for identical vectors', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2, 3];
            expect(euclideanDistance(v1, v2)).toBeCloseTo(0, 5);
        });

        it('should calculate correct distance', () => {
            const v1 = [0, 0];
            const v2 = [3, 4];
            expect(euclideanDistance(v1, v2)).toBeCloseTo(5, 5);
        });

        it('should throw error for mismatched dimensions', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2];
            expect(() => euclideanDistance(v1, v2)).toThrow('Vector dimension mismatch');
        });
    });

    describe('normalizeVector', () => {
        it('should normalize a vector to unit length', () => {
            const v = [3, 4];
            const normalized = normalizeVector(v);
            expect(normalized[0]).toBeCloseTo(0.6, 5);
            expect(normalized[1]).toBeCloseTo(0.8, 5);

            // Check unit length
            const length = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
            expect(length).toBeCloseTo(1.0, 5);
        });

        it('should handle zero vectors', () => {
            const v = [0, 0, 0];
            const normalized = normalizeVector(v);
            expect(normalized).toEqual([0, 0, 0]);
        });

        it('should work with already normalized vectors', () => {
            const v = [0.6, 0.8];
            const normalized = normalizeVector(v);
            expect(normalized[0]).toBeCloseTo(0.6, 5);
            expect(normalized[1]).toBeCloseTo(0.8, 5);
        });
    });

    describe('dotProduct', () => {
        it('should calculate correct dot product', () => {
            const v1 = [1, 2, 3];
            const v2 = [4, 5, 6];
            expect(dotProduct(v1, v2)).toBe(32); // 1*4 + 2*5 + 3*6 = 32
        });

        it('should return 0 for orthogonal vectors', () => {
            const v1 = [1, 0];
            const v2 = [0, 1];
            expect(dotProduct(v1, v2)).toBe(0);
        });

        it('should throw error for mismatched dimensions', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2];
            expect(() => dotProduct(v1, v2)).toThrow('Vector dimension mismatch');
        });
    });

    describe('findTopKSimilar', () => {
        it('should return top k most similar vectors', () => {
            const query = [1, 0];
            const vectors = [
                { vector: [1, 0], data: 'identical' },
                { vector: [0, 1], data: 'orthogonal' },
                { vector: [0.9, 0.1], data: 'similar' },
                { vector: [-1, 0], data: 'opposite' },
                { vector: [0.7, 0.3], data: 'somewhat similar' },
            ];

            const top3 = findTopKSimilar(query, vectors, 3);

            expect(top3).toHaveLength(3);
            expect(top3[0].data).toBe('identical');
            expect(top3[0].score).toBeCloseTo(1.0, 5);
            expect(top3[1].data).toBe('similar');
            expect(top3[2].data).toBe('somewhat similar');
        });

        it('should handle k larger than array size', () => {
            const query = [1, 0];
            const vectors = [
                { vector: [1, 0], data: 'a' },
                { vector: [0, 1], data: 'b' },
            ];

            const top10 = findTopKSimilar(query, vectors, 10);
            expect(top10).toHaveLength(2);
        });

        it('should return empty array for empty input', () => {
            const query = [1, 0];
            const vectors: Array<{ vector: number[]; data: string }> = [];

            const result = findTopKSimilar(query, vectors, 5);
            expect(result).toHaveLength(0);
        });
    });

    describe('batchCosineSimilarity', () => {
        it('should calculate similarity for all candidates', () => {
            const query = [1, 0];
            const candidates = [
                [1, 0],
                [0, 1],
                [0.7, 0.3],
            ];

            const similarities = batchCosineSimilarity(query, candidates);

            expect(similarities).toHaveLength(3);
            expect(similarities[0]).toBeCloseTo(1.0, 5);
            expect(similarities[1]).toBeCloseTo(0.0, 5);
            expect(similarities[2]).toBeGreaterThan(0);
        });

        it('should return empty array for empty candidates', () => {
            const query = [1, 0];
            const candidates: number[][] = [];

            const similarities = batchCosineSimilarity(query, candidates);
            expect(similarities).toHaveLength(0);
        });
    });

    describe('isNormalized', () => {
        it('should return true for normalized vectors', () => {
            const v = [0.6, 0.8];
            expect(isNormalized(v)).toBe(true);
        });

        it('should return false for non-normalized vectors', () => {
            const v = [3, 4];
            expect(isNormalized(v)).toBe(false);
        });

        it('should handle tolerance parameter', () => {
            const v = [0.6, 0.8000001]; // Slightly off
            expect(isNormalized(v, 1e-5)).toBe(true);
            expect(isNormalized(v, 1e-10)).toBe(false);
        });
    });

    describe('Real-world embedding scenarios', () => {
        it('should find similar text embeddings', () => {
            // Simulate embeddings for similar texts
            // In reality these would be from a model, but we'll create synthetic ones
            const queryEmbedding = normalizeVector([0.5, 0.3, 0.8, 0.1]);

            const documents = [
                { vector: normalizeVector([0.51, 0.29, 0.81, 0.09]), data: 'Very similar doc' },
                { vector: normalizeVector([0.1, 0.9, 0.2, 0.5]), data: 'Different doc' },
                { vector: normalizeVector([0.49, 0.31, 0.79, 0.11]), data: 'Similar doc' },
            ];

            const results = findTopKSimilar(queryEmbedding, documents, 2);

            expect(results[0].data).toBe('Very similar doc');
            expect(results[0].score).toBeGreaterThan(0.99);
            expect(results[1].data).toBe('Similar doc');
        });
    });
});
