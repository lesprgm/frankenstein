import fs from 'node:fs';
import path from 'node:path';
import type { DaemonConfig } from './types';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG: DaemonConfig = {
  backend: {
    url: process.env.GHOST_BACKEND_URL || 'http://localhost:4000',
    apiKey: process.env.GHOST_API_KEY || 'dev-api-key',
  },
  autoLaunch: true,
  user: {
    id: process.env.GHOST_USER_ID || 'demo',
    workspace_id: process.env.GHOST_WORKSPACE_ID || 'demo',
  },
  vision: {
    enabled: true,
    // Only capture when explicitly requested ("remind me", "what's on my screen", etc.)
    captureMode: 'on-demand',
  },
  privacy: {
    mode: 'local-preferred',
    redact_emails_in_prompts: true,
    redact_file_paths_in_prompts: true,
    max_prompt_history_days: 14,
  },
  voice: {
    sttProvider: 'local-whisper',
    sttApiKey: process.env.GEMINI_API_KEY,
    sttModel: process.env.GEMINI_STT_MODEL || 'default',
    sttEndpoint: process.env.GEMINI_STT_ENDPOINT,
    ttsProvider: 'system',
    ttsApiKey: undefined,
    ttsVoiceId: process.env.ELEVENLABS_VOICE_ID,
    ttsModelId: process.env.ELEVENLABS_MODEL_ID,
    hotkey: 'Alt+Space',
    silenceThreshold: 0.01,
    maxRecordingDuration: 8_000,
    chimeSound: undefined,
  },
  files: {
    scanDirectories: [path.join(process.env.HOME || '', 'Documents')],
    includeExtensions: ['pdf', 'docx', 'md', 'txt', 'pptx'],
    maxDepth: 3,
    excludePatterns: ['**/node_modules/**', '**/.git/**'],
  },
};

export function loadConfig(): DaemonConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<DaemonConfig>;
  const merged = deepMerge(DEFAULT_CONFIG, parsed);

  const validationErrors = validateConfig(merged);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid config: ${validationErrors.join(', ')}`);
  }

  return merged;
}

function validateConfig(config: DaemonConfig): string[] {
  const errors: string[] = [];
  if (!config.backend.url) errors.push('backend.url is required');
  if (!config.backend.apiKey) errors.push('backend.apiKey is required');
  if (!config.user.id) errors.push('user.id is required');
  return errors;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const output: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === 'object') {
      output[key] = deepMerge((base as any)[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
