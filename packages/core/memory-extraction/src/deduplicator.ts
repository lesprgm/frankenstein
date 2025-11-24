/**
 * Memory deduplication logic
 * 
 * Provides deterministic ID generation and deduplication for extracted memories.
 * Uses content-based hashing to ensure stable IDs across incremental extractions.
 */

import { createHash } from 'crypto';
import { ExtractedMemory } from './types.js';

/**
 * Handles deduplication of extracted memories
 */
export class MemoryDeduplicator {
  /**
   * Generate a deterministic ID for a memory based on its content
   * Uses hash(type + normalized_content + workspace_id)
   */
  generateMemoryId(memory: Partial<ExtractedMemory>): string {
    if (!memory.type || !memory.content || !memory.workspace_id) {
      throw new Error('Memory must have type, content, and workspace_id to generate ID');
    }

    const normalizedContent = this.normalizeContent(memory.content);
    
    // For entities, include entity type and name in the hash for better uniqueness
    let hashInput = `${memory.type}:${normalizedContent}:${memory.workspace_id}`;
    
    if (memory.type === 'entity' && memory.metadata?.entityType && memory.metadata?.name) {
      const normalizedName = this.normalizeContent(memory.metadata.name);
      hashInput = `${memory.type}:${memory.metadata.entityType}:${normalizedName}:${normalizedContent}:${memory.workspace_id}`;
    }

    return this.hash(hashInput);
  }

  /**
   * Normalize content for consistent comparison and hashing
   * - Convert to lowercase
   * - Trim whitespace
   * - Remove extra whitespace (multiple spaces/newlines to single space)
   */
  normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Check if two memories are duplicates
   * Memories are duplicates if they have the same type, normalized content, and workspace_id
   */
  areDuplicates(m1: ExtractedMemory, m2: ExtractedMemory): boolean {
    if (m1.type !== m2.type || m1.workspace_id !== m2.workspace_id) {
      return false;
    }

    const normalizedContent1 = this.normalizeContent(m1.content);
    const normalizedContent2 = this.normalizeContent(m2.content);

    if (normalizedContent1 !== normalizedContent2) {
      return false;
    }

    // For entities, also check entity type and name
    if (m1.type === 'entity' && m2.type === 'entity') {
      const entityType1 = m1.metadata?.entityType;
      const entityType2 = m2.metadata?.entityType;
      const name1 = m1.metadata?.name ? this.normalizeContent(m1.metadata.name) : null;
      const name2 = m2.metadata?.name ? this.normalizeContent(m2.metadata.name) : null;

      if (entityType1 !== entityType2 || name1 !== name2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Remove duplicate memories from an array
   * Returns array with duplicates removed, keeping the first occurrence of each unique memory
   */
  deduplicate(memories: ExtractedMemory[]): ExtractedMemory[] {
    const seen = new Map<string, ExtractedMemory>();
    const result: ExtractedMemory[] = [];

    for (const memory of memories) {
      const id = this.generateMemoryId(memory);
      
      if (seen.has(id)) {
        // Merge with existing memory
        const existing = seen.get(id)!;
        const merged = this.merge([existing, memory]);
        seen.set(id, merged);
      } else {
        seen.set(id, memory);
        result.push(memory);
      }
    }

    // Update result array with merged memories
    return Array.from(seen.values());
  }

  /**
   * Merge duplicate memories into a single memory
   * - Keep highest confidence score
   * - Merge source_message_ids (unique)
   * - Merge metadata (prefer non-null values, keep from highest confidence)
   * - Use earliest created_at timestamp
   */
  merge(memories: ExtractedMemory[]): ExtractedMemory {
    if (memories.length === 0) {
      throw new Error('Cannot merge empty array of memories');
    }

    if (memories.length === 1) {
      return memories[0];
    }

    // Sort by confidence (highest first)
    const sorted = [...memories].sort((a, b) => b.confidence - a.confidence);
    const highest = sorted[0];

    // Merge source_message_ids (unique)
    const allMessageIds = new Set<string>();
    for (const memory of memories) {
      for (const msgId of memory.source_message_ids) {
        allMessageIds.add(msgId);
      }
    }

    // Merge metadata - start with highest confidence memory's metadata
    const mergedMetadata: Record<string, any> = { ...highest.metadata };
    
    // Add any missing fields from other memories
    for (const memory of sorted.slice(1)) {
      if (memory.metadata) {
        for (const [key, value] of Object.entries(memory.metadata)) {
          if (mergedMetadata[key] === undefined || mergedMetadata[key] === null) {
            mergedMetadata[key] = value;
          }
        }
      }
    }

    // Find earliest created_at
    const earliestCreatedAt = memories.reduce((earliest, memory) => {
      return new Date(memory.created_at) < new Date(earliest) ? memory.created_at : earliest;
    }, memories[0].created_at);

    return {
      ...highest,
      source_message_ids: Array.from(allMessageIds).sort(),
      metadata: mergedMetadata,
      created_at: earliestCreatedAt,
    };
  }

  /**
   * Create a SHA-256 hash of the input string and convert to UUID format
   * Takes first 32 hex chars and formats as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   */
  private hash(input: string): string {
    const hash = createHash('sha256').update(input).digest('hex');
    // Convert to UUID format (8-4-4-4-12)
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }
}
