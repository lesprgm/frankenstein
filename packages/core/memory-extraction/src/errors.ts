/**
 * Error types for memory extraction operations
 */

export interface ValidationError {
  field: string;
  message: string;
  memoryId?: string;
}

export type ExtractionError =
  | { type: 'llm_error'; provider: string; message: string; cause?: unknown }
  | { type: 'rate_limit'; retryAfter: number }
  | { type: 'validation_error'; errors: ValidationError[] }
  | { type: 'configuration_error'; message: string }
  | { type: 'parse_error'; message: string; rawResponse?: string };

/**
 * Result type for operations that can fail
 */
export type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E };
