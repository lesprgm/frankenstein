/**
 * Vector utility functions for similarity search and operations
 */

/**
 * Calculate cosine similarity between two vectors
 * 
 * Cosine similarity measures the cosine of the angle between two vectors,
 * producing a value between -1 and 1 (typically 0 to 1 for embeddings).
 * 
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity score (0-1, where 1 is identical)
 * @throws Error if vectors have different lengths
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    if (a.length === 0) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) {
        return 0; // Handle zero vectors
    }

    return dotProduct / denominator;
}

/**
 * Calculate Euclidean distance between two vectors
 * 
 * @param a - First vector
 * @param b - Second vector
 * @returns Euclidean distance (lower is more similar)
 * @throws Error if vectors have different lengths
 */
export function euclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }

    return Math.sqrt(sum);
}

/**
 * Normalize a vector to unit length
 * 
 * @param vector - Vector to normalize
 * @returns Normalized vector
 */
export function normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    if (norm === 0) {
        return vector;
    }

    return vector.map(val => val / norm);
}

/**
 * Calculate dot product of two vectors
 * 
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product
 * @throws Error if vectors have different lengths
 */
export function dotProduct(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * Find top-k most similar vectors using cosine similarity
 * 
 * @param queryVector - Query vector to compare against
 * @param vectors - Array of vectors with associated data
 * @param k - Number of top results to return
 * @returns Top k results sorted by similarity (descending)
 */
export function findTopKSimilar<T>(
    queryVector: number[],
    vectors: Array<{ vector: number[]; data: T }>,
    k: number
): Array<{ data: T; score: number }> {
    // Calculate similarity for each vector
    const scored = vectors.map(({ vector, data }) => ({
        data,
        score: cosineSimilarity(queryVector, vector),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top k
    return scored.slice(0, k);
}

/**
 * Batch calculate cosine similarities
 * 
 * Efficiently calculates similarity between a query vector and multiple candidate vectors.
 * 
 * @param queryVector - Query vector
 * @param candidateVectors - Array of candidate vectors
 * @returns Array of similarity scores
 */
export function batchCosineSimilarity(
    queryVector: number[],
    candidateVectors: number[][]
): number[] {
    return candidateVectors.map(candidate => cosineSimilarity(queryVector, candidate));
}

/**
 * Check if a vector is normalized (unit length)
 * 
 * @param vector - Vector to check
 * @param tolerance - Tolerance for floating point comparison
 * @returns True if vector is normalized
 */
export function isNormalized(vector: number[], tolerance: number = 1e-6): boolean {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return Math.abs(norm - 1.0) < tolerance;
}
