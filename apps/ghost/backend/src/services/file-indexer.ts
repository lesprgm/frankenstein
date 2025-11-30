import type { FileIndexRequest, IndexError, MemoryReference, Result } from '../types.js';
import { storageService } from './storage.js';
import { fileContentIngestor } from './file-content-ingestor.js';

/**
 * Handles conversion of file metadata into memories for later recall.
 */
export class FileIndexer {
  async indexFiles(
    payload: FileIndexRequest
  ): Promise<Result<{ indexed: number; memories: MemoryReference[] }, IndexError>> {
    if (!payload.user_id) {
      return { ok: false, error: { type: 'validation_error', message: 'user_id is required' } };
    }
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      return { ok: false, error: { type: 'validation_error', message: 'files must be a non-empty array' } };
    }

    const result = await storageService.indexFiles(payload);
    if (!result.ok) {
      return { ok: false, error: { type: 'storage_error', message: result.error.message } };
    }

    // Kick off lightweight content ingestion (non-blocking).
    fileContentIngestor.ingest(payload).catch((error) => {
      console.warn('[Ghost][Ingest] Background file ingestion failed', error);
    });

    return { ok: true, value: result.value };
  }
}

export const fileIndexer = new FileIndexer();
