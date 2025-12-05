import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import type {
  ActionResult,
  CommandRequest,
  CommandResponse,
  DashboardData,
  FileIndexRequest,
  FileMetadata,
  Result,
} from '../types';
import type { DaemonConfig } from '../types';

/**
 * Thin HTTP client for communicating with the Ghost backend.
 */
export class GhostAPIClient {
  private client: AxiosInstance;
  private userId: string;

  constructor(private config: DaemonConfig) {
    this.client = axios.create({
      baseURL: config.backend.url,
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${config.backend.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.userId = config.user.id;
  }

  async sendCommand(text: string, screenContext?: string, screenshotPath?: string, conversationalMode?: boolean): Promise<Result<CommandResponse, any>> {
    const payload: CommandRequest = {
      user_id: this.userId,
      command_id: crypto.randomUUID(),
      text,
      timestamp: new Date().toISOString(),
      screen_context: screenContext,
      screenshot_path: screenshotPath,
      conversational_mode: conversationalMode,
      meta: {
        source: 'voice',
        client_version: '0.1.0',
      },
    };

    try {
      const response = await this.client.post<CommandResponse>('/api/command', payload);
      return { ok: true, value: response.data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Streaming version of sendCommand using SSE-style chunks.
   * Emits token events via onToken; resolves with the final CommandResponse.
   */
  async sendCommandStream(
    text: string,
    onToken?: (token: string) => void,
    screenContext?: string,
    screenshotPath?: string,
    conversationalMode?: boolean
  ): Promise<Result<CommandResponse, any>> {
    const payload: CommandRequest = {
      user_id: this.userId,
      command_id: crypto.randomUUID(),
      text,
      timestamp: new Date().toISOString(),
      screen_context: screenContext,
      screenshot_path: screenshotPath,
      conversational_mode: conversationalMode,
      meta: {
        source: 'voice',
        client_version: '0.1.0',
      },
    };

    try {
      const resp = await fetch(`${this.config.backend.url}/api/command/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.backend.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok || !resp.body) {
        return { ok: false, error: new Error(`HTTP ${resp.status}`) };
      }

      const reader = resp.body.getReader();
      let buffer = '';
      let finalResponse: CommandResponse | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const { event, data } = parseSSE(rawEvent);
          if (!event || !data) continue;

          if (event === 'token') {
            try {
              const parsed = JSON.parse(data) as { text: string };
              if (parsed.text && onToken) onToken(parsed.text);
            } catch (e) {
              console.warn('Failed to parse token event', e);
            }
          } else if (event === 'final') {
            try {
              finalResponse = JSON.parse(data) as CommandResponse;
            } catch (e) {
              return { ok: false, error: e };
            }
          } else if (event === 'error') {
            return { ok: false, error: new Error(data) };
          }
        }
      }

      if (finalResponse) {
        return { ok: true, value: finalResponse };
      }
      return { ok: false, error: new Error('Stream ended without final response') };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async indexFiles(files: FileMetadata[]): Promise<Result<{ indexed: number }, any>> {
    const payload: FileIndexRequest = { user_id: this.userId, files };
    try {
      const response = await this.client.post('/api/files/index', payload);
      return { ok: true, value: response.data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async sendActionResults(commandId: string, actions: ActionResult[]): Promise<void> {
    // Placeholder for future logging endpoint
    console.debug('Action results for', commandId, actions);
  }

  async getDashboardData(): Promise<Result<DashboardData, any>> {
    try {
      const response = await this.client.get<DashboardData>('/api/dashboard/commands');
      return { ok: true, value: response.data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Create a memory (for demo mode reminder storage)
   */
  async createMemory(memory: { type: string; summary: string; metadata: any }): Promise<Result<{ id: string }, any>> {
    try {
      const payload = {
        user_id: this.userId,
        ...memory,
        timestamp: new Date().toISOString()
      };
      const response = await this.client.post('/api/memories/create', payload);
      return { ok: true, value: response.data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Summarize screen context (OCR text) using the backend's LLM.
   * 
   * Used when creating reminders to generate an intelligent summary
   * of what the user was looking at (code, documents, etc.)
   * 
   * @param text - The OCR-extracted text from the screenshot
   * @returns A concise summary, or null if summarization fails
   */
  async summarizeContext(text: string): Promise<Result<string | null, any>> {
    try {
      const response = await this.client.post<{ summary: string | null }>('/api/summarize-context', { text });
      return { ok: true, value: response.data.summary };
    } catch (error) {
      console.warn('[Ghost][APIClient] Failed to summarize context:', error);
      return { ok: false, error };
    }
  }
}

function parseSSE(raw: string): { event: string | null; data: string | null } {
  const lines = raw.split('\n').map((l) => l.trim());
  let event: string | null = null;
  let data: string | null = null;
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data = line.slice('data:'.length).trim();
  }
  return { event, data };
}
