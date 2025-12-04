/**
 * Shared types for Ghost Backend
 */

// API Request/Response types
export interface CommandRequest {
  user_id: string;
  command_id: string;
  text: string;
  timestamp: string;
  screen_context?: string;
  screenshot_path?: string;
  meta: {
    source: 'voice';
    client_version: string;
  };
}

export interface CommandResponse {
  command_id: string;
  assistant_text: string;
  actions: Action[];
  memories_used: MemoryReference[];
}

export interface Action {
  type: 'file.open' | 'file.scroll' | 'file.index' | 'info.recall' | 'info.summarize' | 'reminder.create';
  params: FileOpenParams | FileScrollParams | FileIndexParams | InfoRecallParams | InfoSummarizeParams | ReminderCreateParams;
}

export interface FileIndexParams {
  path: string;
}

export interface FileOpenParams {
  path: string;
  page?: number; // optional page number hint
  section?: string; // optional section/heading hint
  lineNumber?: number; // optional line number for code files
}

export interface FileScrollParams {
  direction: 'up' | 'down';
  amount?: number; // optional scroll amount in pixels or lines
}

export interface InfoRecallParams {
  summary: string;
  confidence?: number; // optional confidence score
}

export interface InfoSummarizeParams {
  topic: string;
  sources: string[]; // memory IDs or file paths
  format: 'brief' | 'detailed' | 'timeline';
}

export interface ReminderCreateParams {
  title: string;
  notes?: string;
  dueDate?: string;
}

export interface MemoryReference {
  id: string;
  type: string;
  score: number;
  summary: string;
  metadata?: Record<string, any>;
}

export interface FileMetadata {
  path: string;
  name: string;
  modified: string;
  size: number;
}

export interface FileIndexRequest {
  user_id: string;
  files: FileMetadata[];
}

// Dashboard types
export interface DashboardData {
  commands: CommandEntry[];
  stats: DashboardStats;
}

export interface CommandEntry {
  id: string;
  text: string;
  assistant_text: string;
  timestamp: string;
  actions: ActionResult[];
  memories_used: MemoryReference[];
}

export interface ActionResult {
  action: Action;
  status: 'success' | 'failed';
  error?: string;
  executedAt: string;
}

export interface DashboardStats {
  totalCommands: number;
  totalMemories: number;
  successRate: number;
}

// LLM types
export interface LLMResponse {
  assistant_text: string;
  actions: Action[];
}

export interface LLMConfig {
  provider: 'gemini';
  apiKey: string;
  model: string;
  temperature: number;
}

// Context types
export interface ContextOptions {
  template?: string;
  tokenBudget?: number;
  includeRelationships?: boolean;
  relationshipDepth?: number;
  memoryTypes?: string[];
}

export interface ContextResult {
  context: string;
  memories: Array<{
    memory: any;
    score: number;
  }>;
}

// Error types
export type ProcessError =
  | { type: 'storage_error'; message: string }
  | { type: 'context_error'; message: string }
  | { type: 'llm_error'; message: string }
  | { type: 'validation_error'; message: string };

export type IndexError =
  | { type: 'storage_error'; message: string }
  | { type: 'validation_error'; message: string };

export type ContextError =
  | { type: 'embedding_error'; message: string }
  | { type: 'storage_error'; message: string }
  | { type: 'invalid_query'; message: string };

// Result type
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
