/**
 * Error types for storage operations
 */

export type StorageError =
  | { type: 'not_found'; resource: string; id: string }
  | { type: 'validation'; field: string; message: string }
  | { type: 'conflict'; message: string }
  | { type: 'database'; message: string; cause?: unknown }
  | { type: 'vector_store'; message: string; cause?: unknown };

/**
 * Result type for storage operations
 */
export type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E };
