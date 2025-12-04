import crypto from 'node:crypto';
import { computeFileFingerprint } from '../utils/file-fingerprint.js';
import type {
  Action,
  ActionResult,
  CommandEntry,
  CommandRequest,
  CommandResponse,
  DashboardData,
  DashboardStats,
  FileIndexRequest,
  FileMetadata,
  MemoryReference,
  Result,
} from '../types.js';

type StoredMemory = MemoryReference & {
  createdAt: string;
  workspace_id: string;
  source: 'command' | 'file' | 'action';
  metadata?: Record<string, any>;
};

const SCORE_FLOOR = 0.3;

/**
 * Lightweight in-memory storage layer used for the Ghost MVP.
 * This mirrors the shape of the real Storage Layer but keeps dependencies minimal
 * for local development and demo environments.
 */
export class InMemoryStorage {
  private commands: CommandEntry[] = [];
  private memories: StoredMemory[] = [];

  constructor() {
    // Seed a small amount of demo data for dashboard previews
    this.seedDemoData();
  }

  /**
   * Health indicator for the storage layer
   */
  getHealth(): Result<{ status: 'ok'; mode: 'in-memory' }, { type: 'storage_error'; message: string }> {
    return { ok: true, value: { status: 'ok', mode: 'in-memory' } };
  }

  /**
   * Persist a command + response pair and attach context memories
   */
  async saveCommand(
    request: CommandRequest,
    response: CommandResponse,
    memoriesUsed: MemoryReference[]
  ): Promise<Result<CommandResponse, { type: 'storage_error'; message: string }>> {
    try {
      const actions: ActionResult[] = response.actions.map((action) => ({
        action,
        status: 'success',
        executedAt: new Date().toISOString(),
      }));

      this.commands.unshift({
        id: request.command_id,
        text: request.text,
        assistant_text: response.assistant_text,
        timestamp: request.timestamp,
        actions,
        memories_used: memoriesUsed,
      });

      // Keep command history reasonably small for the MVP
      this.commands = this.commands.slice(0, 200);

      // Track memories that were used for this command
      memoriesUsed.forEach((memory) => {
        this.memories.push({
          ...memory,
          createdAt: new Date().toISOString(),
          workspace_id: request.user_id,
          source: 'command',
        });
      });

      return { ok: true, value: response };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Store new memories extracted from a conversation
   */
  addMemories(memories: StoredMemory[]): void {
    this.memories.unshift(...memories);
    this.memories = this.memories.slice(0, 1000);
  }

  getRecentFiles(userId: string, limit: number = 6): Result<MemoryReference[], { type: 'storage_error'; message: string }> {
    try {
      const files = this.memories
        .filter((m) => m.workspace_id === userId && m.type === 'entity.file')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map((m) => ({
          id: m.id,
          type: m.type,
          score: m.score,
          summary: m.summary,
          metadata: m.metadata,
        }));
      return { ok: true, value: files };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Simple semantic-ish search over stored memories
   */
  searchMemories(
    queryText: string,
    userId: string,
    limit: number = 8
  ): Result<Array<{ memory: StoredMemory; score: number }>, { type: 'storage_error'; message: string }> {
    try {
      const terms = normalize(queryText).split(/\s+/).filter(Boolean);

      const scored = this.memories
        .filter((mem) => mem.workspace_id === userId || mem.workspace_id === 'demo')
        .map((mem) => {
          const normalized = normalize(mem.summary);
          const matches = terms.reduce((score, term) => (normalized.includes(term) ? score + 1 : score), 0);
          const score = Math.max(SCORE_FLOOR, Math.min(1, matches / Math.max(1, terms.length)));
          return { memory: mem, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return { ok: true, value: scored };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Index a batch of files as entity memories
   */
  async indexFiles(
    payload: FileIndexRequest
  ): Promise<Result<{ indexed: number; memories: MemoryReference[] }, { type: 'storage_error'; message: string }>> {
    try {
      const memories = payload.files.map((file) => this.buildFileMemory(file, payload.user_id));
      this.addMemories(
        memories.map((mem) => ({
          ...mem,
          workspace_id: payload.user_id,
          createdAt: new Date().toISOString(),
          source: 'file',
        }))
      );
      return { ok: true, value: { indexed: memories.length, memories } };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'storage_error', message: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Return dashboard payload with commands and aggregate stats
   */
  getDashboardData(limit: number = 50): DashboardData {
    const commands = this.commands.slice(0, limit);
    return {
      commands,
      stats: this.getStats(),
    };
  }

  /**
   * Compute dashboard statistics
   */
  getStats(): DashboardStats {
    const totalCommands = this.commands.length;
    const totalMemories = this.memories.length;

    const successActions = this.commands.flatMap((cmd) => cmd.actions).filter((a) => a.status === 'success').length;
    const totalActions = this.commands.reduce((sum, cmd) => sum + cmd.actions.length, 0);
    const successRate = totalActions === 0 ? 1 : successActions / totalActions;

    return {
      totalCommands,
      totalMemories,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * Build a memory object for a file index entry
   */
  private buildFileMemory(file: FileMetadata, userId: string): MemoryReference {
    const fingerprint = computeFileFingerprint(file.path, file.size, file.modified);
    return {
      id: `file-${crypto.createHash('md5').update(file.path).digest('hex')}`,
      type: 'entity.file',
      score: 0.3, // Low score for metadata-only; content ingestion will create higher-scored fact memories
      summary: `${file.name} (modified ${file.modified}) @ ${file.path}`,
      metadata: {
        path: file.path,
        name: file.name,
        modified: file.modified,
        size: file.size,
        userId,
        fingerprint,
      },
    };
  }

  /**
   * Seed demo data for the three hero scenarios
   */
  private seedDemoData(): void {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const demoFiles: StoredMemory[] = [
      {
        id: 'mem-demo-file-1',
        type: 'entity.file',
        score: 0.9,
        summary: 'Q4_Sales_Report.pdf, last modified yesterday 3pm',
        createdAt: yesterday.toISOString(),
        workspace_id: 'demo',
        source: 'file',
        metadata: { path: '/Users/demo/Documents/Q4_Sales_Report.pdf' },
      },
      {
        id: 'mem-demo-person-1',
        type: 'entity.person',
        score: 0.88,
        summary: 'Sarah - sarah@company.com',
        createdAt: now.toISOString(),
        workspace_id: 'demo',
        source: 'command',
      },
      {
        id: 'mem-demo-file-2',
        type: 'entity.file',
        score: 0.85,
        summary: 'ACME_Q4_Launch_Notes.md, last modified two days ago',
        createdAt: now.toISOString(),
        workspace_id: 'demo',
        source: 'file',
        metadata: { path: '/Users/demo/Documents/ACME_Q4_Launch_Notes.md' },
      },
      {
        id: 'mem-demo-file-3',
        type: 'entity.file',
        score: 0.83,
        summary: 'Sarah_Meeting_Presentation.pptx, modified today',
        createdAt: now.toISOString(),
        workspace_id: 'demo',
        source: 'file',
        metadata: { path: '/Users/demo/Documents/Sarah_Meeting_Presentation.pptx' },
      },
    ];

    this.memories.push(...demoFiles);
  }
}

/**
 * Normalize text for crude similarity scoring
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Use SQLite storage by default
import { SQLiteStorage } from './sqlite-storage.js';

const DATABASE_PATH = process.env.DATABASE_PATH || './ghost.db';
export const storageService = new SQLiteStorage(DATABASE_PATH);
