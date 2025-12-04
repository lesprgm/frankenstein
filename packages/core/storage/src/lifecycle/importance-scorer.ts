/**
 * Importance Scorer - Calculates composite importance scores based on usage patterns
 */

/**
 * Access metrics for importance calculation
 */
export interface AccessMetrics {
  access_count: number;
  last_accessed_at: Date;
  created_at: Date;
  relationship_count: number;
  confidence: number;
}

/**
 * Configurable weights for importance calculation
 */
export interface ImportanceWeights {
  accessFrequency: number; // 0-1
  confidence: number; // 0-1
  relationshipCount: number; // 0-1
}

/**
 * ImportanceScorer - Calculates importance scores for memories based on usage patterns
 */
export class ImportanceScorer {
  private weights: ImportanceWeights;

  constructor(weights: ImportanceWeights) {
    // Validate weights are in valid range
    this.validateWeights(weights);
    this.weights = weights;
  }

  /**
   * Calculate importance score from access metrics
   * @param metrics - Access metrics for the memory
   * @returns Importance score between 0 and 1
   */
  calculateImportance(metrics: AccessMetrics): number {
    // Calculate access frequency (accesses per day)
    const accessFrequency = this.calculateAccessFrequency(metrics);
    
    // Normalize each component to 0-1 range
    // Access frequency: normalize with midpoint at 1 access/day
    const normalizedFrequency = this.normalize(accessFrequency, 1.0, 2.0);
    
    // Confidence is already 0-1
    const normalizedConfidence = metrics.confidence;
    
    // Relationship count: normalize with midpoint at 5 relationships
    const normalizedRelationships = this.normalize(metrics.relationship_count, 5.0, 0.5);
    
    // Calculate weighted sum
    const importance = 
      normalizedFrequency * this.weights.accessFrequency +
      normalizedConfidence * this.weights.confidence +
      normalizedRelationships * this.weights.relationshipCount;
    
    // Clamp to [0, 1] range
    return Math.max(0, Math.min(1, importance));
  }

  /**
   * Calculate access frequency (accesses per day)
   * @param metrics - Access metrics
   * @returns Access frequency in accesses per day
   */
  private calculateAccessFrequency(metrics: AccessMetrics): number {
    const now = new Date();
    const ageMs = now.getTime() - metrics.created_at.getTime();
    
    // Avoid division by zero for very new memories
    if (ageMs <= 0) {
      return 0;
    }
    
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    // Avoid division by zero for memories less than a day old
    if (ageDays < 1) {
      // For memories less than a day old, extrapolate to daily rate
      return metrics.access_count / ageDays;
    }
    
    return metrics.access_count / ageDays;
  }

  /**
   * Normalize a value to 0-1 range using sigmoid function
   * @param value - Value to normalize
   * @param midpoint - Value that maps to 0.5
   * @param steepness - Controls how quickly the function transitions (higher = steeper)
   * @returns Normalized value between 0 and 1
   */
  private normalize(value: number, midpoint: number, steepness: number): number {
    // Sigmoid function: 1 / (1 + e^(-k(x - m)))
    // where k is steepness and m is midpoint
    return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
  }

  /**
   * Validate importance weights
   * @param weights - Weights to validate
   * @throws Error if weights are invalid
   */
  private validateWeights(weights: ImportanceWeights): void {
    const { accessFrequency, confidence, relationshipCount } = weights;
    
    // Check all weights are numbers
    if (typeof accessFrequency !== 'number' || 
        typeof confidence !== 'number' || 
        typeof relationshipCount !== 'number') {
      throw new Error('All importance weights must be numbers');
    }
    
    // Check all weights are in [0, 1] range
    if (accessFrequency < 0 || accessFrequency > 1 ||
        confidence < 0 || confidence > 1 ||
        relationshipCount < 0 || relationshipCount > 1) {
      throw new Error('All importance weights must be between 0 and 1');
    }
    
    // Check weights sum to a reasonable range (0.5 to 1.5)
    const sum = accessFrequency + confidence + relationshipCount;
    if (sum < 0.5 || sum > 1.5) {
      throw new Error('Sum of importance weights must be between 0.5 and 1.5');
    }
  }

  /**
   * Get the current importance weights
   */
  getWeights(): ImportanceWeights {
    return { ...this.weights };
  }
}
