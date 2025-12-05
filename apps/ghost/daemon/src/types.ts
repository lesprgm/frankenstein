/**
 * Shared types for Ghost Daemon
 */

// Configuration types
export interface DaemonConfig {
  backend: BackendConfig;
  user: UserConfig;
  privacy: PrivacyConfig;
  voice: VoiceConfig;
  vision?: VisionConfig;
  files: FilesConfig;
  autoLaunch?: boolean;
  conversationalMode?: boolean; // Toggle between action mode (default) and chat mode
}

export interface BackendConfig {
  url: string;
  apiKey: string;
}

export interface UserConfig {
  id: string;
  workspace_id: string;
}

export interface PrivacyConfig {
  mode: 'local-only' | 'local-preferred' | 'cloud-ok';
  redact_emails_in_prompts: boolean;
  redact_file_paths_in_prompts: boolean;
  max_prompt_history_days: number;
}

export interface VoiceConfig {
  sttProvider: 'google' | 'system' | 'gemini' | 'local-whisper' | 'elevenlabs';
  sttApiKey?: string;
  sttModel?: string;
  sttEndpoint?: string;
  ttsProvider: 'system' | 'elevenlabs';
  ttsApiKey?: string;
  ttsVoiceId?: string;
  ttsModelId?: string;
  hotkey: string;
  silenceThreshold: number;
  maxRecordingDuration: number;
  chimeSound?: string;
}

export interface VisionConfig {
  enabled: boolean;
  captureMode: 'always' | 'on-demand';
}

export interface FilesConfig {
  scanDirectories: string[];
  includeExtensions: string[];
  maxDepth: number;
  excludePatterns: string[];
}

// API types
export interface CommandRequest {
  user_id: string;
  command_id: string;
  text: string;
  timestamp: string;
  screen_context?: string;
  screenshot_path?: string;
  conversational_mode?: boolean; // When true, use chat personality; when false, use action mode
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
  type: 'file.open' | 'file.scroll' | 'file.index' | 'info.recall' | 'info.summarize' | 'reminder.create' | 'search.query';
  params: Record<string, any>;
}

export interface ActionResult {
  action: Action;
  status: 'success' | 'failed';
  error?: string;
  executedAt: string;
}

export interface MemoryReference {
  id: string;
  type: string;
  score: number;
  summary: string;
  metadata?: Record<string, any>;
}

export interface ScreenContext {
  text: string;
  screenshotPath: string;
  windowTitle?: string;
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

// Error types
export type VoiceError =
  | { type: 'microphone_access_denied' }
  | { type: 'stt_failed'; message: string }
  | { type: 'recording_timeout' };

export type APIError =
  | { type: 'network_error'; message: string }
  | { type: 'auth_error'; message: string }
  | { type: 'server_error'; status: number; message: string }
  | { type: 'timeout' };

// Result type
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface CommandEntry {
  id: string;
  text: string;
  assistant_text: string;
  timestamp: string;
  actions: ActionResult[];
  memories_used: MemoryReference[];
}

export interface DashboardStats {
  totalCommands: number;
  totalMemories: number;
  successRate: number;
}

export interface DashboardData {
  commands: CommandEntry[];
  stats: DashboardStats;
}
