/**
 * Memory validation logic
 */

import {
  ExtractedMemory,
  ExtractedRelationship,
  ValidationResult,
  BatchValidationResult,
} from './types.js';
import { ValidationError } from './errors.js';

/**
 * Configuration for memory validation
 */
export interface ValidatorConfig {
  minConfidence?: number;          // Default: 0.0 (no filtering)
  minContentLength?: number;       // Default: 3
}

/**
 * Validates extracted memories and relationships
 */
export class MemoryValidator {
  private config: Required<ValidatorConfig>;

  constructor(config: ValidatorConfig = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.0,
      minContentLength: config.minContentLength ?? 3,
    };
  }

  /**
   * Validate a single memory
   */
  validate(memory: ExtractedMemory): ValidationResult {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!memory.type) {
      errors.push({
        field: 'type',
        message: 'Memory type is required',
        memoryId: memory.id,
      });
    }

    if (!memory.content) {
      errors.push({
        field: 'content',
        message: 'Memory content is required',
        memoryId: memory.id,
      });
    }

    if (memory.confidence === undefined || memory.confidence === null) {
      errors.push({
        field: 'confidence',
        message: 'Memory confidence is required',
        memoryId: memory.id,
      });
    }

    if (!memory.workspace_id) {
      errors.push({
        field: 'workspace_id',
        message: 'Memory workspace_id is required',
        memoryId: memory.id,
      });
    }

    if (!memory.conversation_id) {
      errors.push({
        field: 'conversation_id',
        message: 'Memory conversation_id is required',
        memoryId: memory.id,
      });
    }

    // Validate confidence is between 0 and 1
    if (memory.confidence !== undefined && memory.confidence !== null) {
      if (memory.confidence < 0 || memory.confidence > 1) {
        errors.push({
          field: 'confidence',
          message: `Confidence must be between 0 and 1, got ${memory.confidence}`,
          memoryId: memory.id,
        });
      }
    }

    // Validate content is not empty or trivial
    if (memory.content) {
      const trimmedContent = memory.content.trim();
      if (trimmedContent.length < this.config.minContentLength) {
        errors.push({
          field: 'content',
          message: `Content is too short (minimum ${this.config.minContentLength} characters), got ${trimmedContent.length}`,
          memoryId: memory.id,
        });
      }
    }

    // Filter out memories below configured confidence threshold
    if (memory.confidence !== undefined && memory.confidence < this.config.minConfidence) {
      errors.push({
        field: 'confidence',
        message: `Confidence ${memory.confidence} is below minimum threshold ${this.config.minConfidence}`,
        memoryId: memory.id,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate multiple memories
   */
  validateBatch(memories: ExtractedMemory[]): BatchValidationResult {
    const validMemories: ExtractedMemory[] = [];
    const invalidMemories: ExtractedMemory[] = [];
    const allErrors: ValidationError[] = [];

    for (const memory of memories) {
      const result = this.validate(memory);
      
      if (result.valid) {
        validMemories.push(memory);
      } else {
        invalidMemories.push(memory);
        allErrors.push(...result.errors);
      }
    }

    return {
      validMemories,
      invalidMemories,
      errors: allErrors,
    };
  }

  /**
   * Validate relationships reference existing memories and are in same workspace
   */
  validateRelationships(
    relationships: ExtractedRelationship[],
    memories: ExtractedMemory[]
  ): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Create a map of memory IDs to memories for quick lookup
    const memoryMap = new Map<string, ExtractedMemory>();
    for (const memory of memories) {
      memoryMap.set(memory.id, memory);
    }

    for (const relationship of relationships) {
      // Ensure relationships reference existing memories
      const fromMemory = memoryMap.get(relationship.from_memory_id);
      if (!fromMemory) {
        errors.push({
          field: 'from_memory_id',
          message: `Relationship references non-existent memory: ${relationship.from_memory_id}`,
          memoryId: relationship.id,
        });
      }

      const toMemory = memoryMap.get(relationship.to_memory_id);
      if (!toMemory) {
        errors.push({
          field: 'to_memory_id',
          message: `Relationship references non-existent memory: ${relationship.to_memory_id}`,
          memoryId: relationship.id,
        });
      }

      // Validate relationships connect memories in same workspace
      if (fromMemory && toMemory) {
        if (fromMemory.workspace_id !== toMemory.workspace_id) {
          errors.push({
            field: 'workspace_id',
            message: `Relationship connects memories from different workspaces: ${fromMemory.workspace_id} and ${toMemory.workspace_id}`,
            memoryId: relationship.id,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
