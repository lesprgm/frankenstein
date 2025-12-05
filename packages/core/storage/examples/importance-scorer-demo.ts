/**
 * Demo script for ImportanceScorer
 */

import { ImportanceScorer, type AccessMetrics, type ImportanceWeights } from '../src/lifecycle/importance-scorer.js';

// Configure importance weights
const weights: ImportanceWeights = {
  accessFrequency: 0.5,  // 50% weight on access frequency
  confidence: 0.3,       // 30% weight on confidence
  relationshipCount: 0.2 // 20% weight on relationships
};

const scorer = new ImportanceScorer(weights);

console.log('=== ImportanceScorer Demo ===\n');

// Example 1: Frequently accessed, high confidence memory
const highImportanceMetrics: AccessMetrics = {
  access_count: 100,
  last_accessed_at: new Date(),
  created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  relationship_count: 10,
  confidence: 0.9
};

const highImportance = scorer.calculateImportance(highImportanceMetrics);
console.log('High Importance Memory:');
console.log(`  Access Count: ${highImportanceMetrics.access_count}`);
console.log(`  Age: 30 days`);
console.log(`  Relationships: ${highImportanceMetrics.relationship_count}`);
console.log(`  Confidence: ${highImportanceMetrics.confidence}`);
console.log(`  → Importance Score: ${highImportance.toFixed(3)}\n`);

// Example 2: Rarely accessed, low confidence memory
const lowImportanceMetrics: AccessMetrics = {
  access_count: 2,
  last_accessed_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
  created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
  relationship_count: 0,
  confidence: 0.3
};

const lowImportance = scorer.calculateImportance(lowImportanceMetrics);
console.log('Low Importance Memory:');
console.log(`  Access Count: ${lowImportanceMetrics.access_count}`);
console.log(`  Age: 90 days`);
console.log(`  Relationships: ${lowImportanceMetrics.relationship_count}`);
console.log(`  Confidence: ${lowImportanceMetrics.confidence}`);
console.log(`  → Importance Score: ${lowImportance.toFixed(3)}\n`);

// Example 3: New memory with moderate activity
const moderateImportanceMetrics: AccessMetrics = {
  access_count: 10,
  last_accessed_at: new Date(),
  created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  relationship_count: 3,
  confidence: 0.7
};

const moderateImportance = scorer.calculateImportance(moderateImportanceMetrics);
console.log('Moderate Importance Memory:');
console.log(`  Access Count: ${moderateImportanceMetrics.access_count}`);
console.log(`  Age: 7 days`);
console.log(`  Relationships: ${moderateImportanceMetrics.relationship_count}`);
console.log(`  Confidence: ${moderateImportanceMetrics.confidence}`);
console.log(`  → Importance Score: ${moderateImportance.toFixed(3)}\n`);

console.log('=== Weight Configuration ===');
console.log(`Current weights:`, scorer.getWeights());
