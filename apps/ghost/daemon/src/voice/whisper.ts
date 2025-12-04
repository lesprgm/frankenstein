import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Result, VoiceError } from '../types';

/**
 * Simplified STT client. Gemini STT is the desired provider for this project.
 *
 * NOTE: Gemini STT is not implemented in this module. If a `GEMINI_API_KEY` is
 * supplied you must provide a Gemini STT adapter. When no API key is present,
 * this module returns a canned transcript for demo purposes.
 */
export class WhisperSTT {
  constructor(
    private apiKey?: string,
    private opts?: { endpoint?: string; model?: string; provider?: string }
  ) { }

  async transcribe(audio: Buffer): Promise<Result<string, VoiceError>> {
    if (!audio || audio.length === 0) {
      return { ok: false, error: { type: 'recording_timeout' } };
    }

    const provider = this.opts?.provider || 'generic';

    if (!this.apiKey && provider !== 'local-whisper') {
      const fallback = 'What is the status of the ACME Q4 launch?';
      return { ok: true, value: this.stripWakeWord(fallback) };
    }

    // If a remote STT endpoint is configured, attempt to POST audio there.
    const sttEndpoint =
      this.opts?.endpoint ||
      process.env.GEMINI_STT_ENDPOINT ||
      (globalThis as any).__GHOST_STT_ENDPOINT ||
      undefined;
    const sttModel =
      this.opts?.model ||
      process.env.GEMINI_STT_MODEL ||
      (globalThis as any).__GHOST_STT_MODEL ||
      'gemini-audio-1a';

    // Local whisper provider
    if (provider === 'local-whisper') {
      try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-whisper-'));
        const wavPath = path.join(tmpDir, 'audio.wav');
        fs.writeFileSync(wavPath, audio);

        // Resolve whisper binary path
        // 1. Check env var
        // 2. Check project venv (dist/voice -> frankenstein is 5 levels up)
        // 3. Fallback to 'whisper' in PATH
        let whisperCmd = process.env.WHISPER_CMD;
        if (!whisperCmd) {
          const venvPath = path.resolve(__dirname, '../../../../../venv/bin/whisper');
          if (fs.existsSync(venvPath)) {
            whisperCmd = venvPath;
            console.info('[Ghost][STT] Using venv whisper:', venvPath);
          } else {
            whisperCmd = 'whisper';
            console.warn('[Ghost][STT] venv whisper not found at', venvPath, '- falling back to PATH');
          }
        }

        const model = sttModel === 'default' ? 'small' : sttModel;
        const baseName = path.basename(wavPath, path.extname(wavPath));
        const args = [
          wavPath,
          '--language',
          'en',
          '--model',
          model,
          '--output_format',
          'json',
          '--output_dir',
          tmpDir,
          '--verbose',
          'False',
        ];

        console.info('[Ghost][STT] Calling local whisper', { whisperCmd, model });

        const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
          const child = spawn(whisperCmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (d) => (stderr += d.toString()));
          child.on('close', (code) => resolve({ code, stderr }));
          child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
        });

        if (result.code !== 0) {
          console.error('[Ghost][STT] Local whisper failed', result.stderr.trim());
          return { ok: false, error: { type: 'stt_failed', message: 'Local whisper failed' } };
        }

        const jsonPath = path.join(tmpDir, `${baseName}.json`);
        if (!fs.existsSync(jsonPath)) {
          console.error('[Ghost][STT] Local whisper output missing', jsonPath);
          return { ok: false, error: { type: 'stt_failed', message: 'No whisper output' } };
        }

        const dataRaw = fs.readFileSync(jsonPath, 'utf-8');
        const parsed: any = JSON.parse(dataRaw);
        const segments: string[] = parsed?.segments?.map((s: any) => s.text).filter(Boolean) || [];
        const text = segments.join(' ').trim();
        if (text) return { ok: true, value: this.stripWakeWord(text) };
        return { ok: false, error: { type: 'stt_failed', message: 'No transcript in whisper output' } };
      } catch (error) {
        return { ok: false, error: { type: 'stt_failed', message: error instanceof Error ? error.message : 'Unknown error' } };
      }
    }

    if (!sttEndpoint) {
      return { ok: false, error: { type: 'stt_failed', message: 'Remote STT endpoint not configured. Set sttEndpoint or GEMINI_STT_ENDPOINT.' } };
    }

    const apiKey = this.apiKey || process.env.GEMINI_API_KEY || '';
    const useQueryKey = apiKey.startsWith('AIza');
    const isGoogleSpeech = /speech\.googleapis\.com/.test(sttEndpoint) || this.opts?.provider === 'google';

    try {
      if (provider === 'elevenlabs') {
        const FormDataCtor = (globalThis as any).FormData;
        const BlobCtor = (globalThis as any).Blob;
        if (!FormDataCtor || !BlobCtor) {
          return { ok: false, error: { type: 'stt_failed', message: 'FormData/Blob not available in this runtime' } };
        }

        const form = new FormDataCtor();
        form.append('file', new BlobCtor([audio]), 'audio.wav');
        form.append('model_id', sttModel && sttModel !== 'default' ? sttModel : 'scribe_v2');

        console.info('[Ghost][STT] Calling ElevenLabs STT', { url: sttEndpoint, model: sttModel });

        const response = await fetch(sttEndpoint, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
          },
          body: form as any,
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[Ghost][STT] ElevenLabs STT error', response.status, errText);
          return { ok: false, error: { type: 'stt_failed', message: `HTTP ${response.status}` } };
        }

        const data: any = await response.json();
        const text =
          data?.text ||
          data?.transcript ||
          data?.results?.[0]?.alternatives?.[0]?.transcript ||
          null;
        if (text) return { ok: true, value: this.stripWakeWord(String(text)) };
        return { ok: false, error: { type: 'stt_failed', message: 'No transcript in ElevenLabs response' } };
      }

      if (isGoogleSpeech) {
        // Google Cloud Speech-to-Text expects base64 audio JSON payload
        const body = {
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16_000,
            languageCode: 'en-US',
          },
          audio: {
            content: audio.toString('base64'),
          },
        };

        const url = useQueryKey ? `${sttEndpoint}?key=${encodeURIComponent(apiKey)}` : sttEndpoint;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (!useQueryKey && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        console.info('[Ghost][STT] Calling Google Speech endpoint', { url, useQueryKey, provider });

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[Ghost][STT] Speech endpoint error', response.status, errText);
          return { ok: false, error: { type: 'stt_failed', message: `HTTP ${response.status}` } };
        }

        const data: any = await response.json();
        const text =
          data?.results?.[0]?.alternatives?.[0]?.transcript ||
          data?.text ||
          data?.transcript ||
          null;
        if (text) return { ok: true, value: this.stripWakeWord(String(text)) };
        return { ok: false, error: { type: 'stt_failed', message: 'No transcript in STT response' } };
      }

      // Fallback: generic multipart upload (Gemini-style)
      const FormDataCtor = (globalThis as any).FormData;
      const BlobCtor = (globalThis as any).Blob;
      if (!FormDataCtor || !BlobCtor) {
        return { ok: false, error: { type: 'stt_failed', message: 'FormData/Blob not available in this runtime' } };
      }

      const form = new FormDataCtor();
      form.append('file', new BlobCtor([audio]), 'audio.wav');
      form.append('model', sttModel);

      const url = useQueryKey ? `${sttEndpoint}?key=${encodeURIComponent(apiKey)}` : sttEndpoint;
      const headers: Record<string, string> = {};
      if (!useQueryKey && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      console.info('[Ghost][STT] Calling generic STT endpoint', { url, model: sttModel, provider });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: form as any,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Ghost][STT] STT endpoint error', response.status, errText);
        return { ok: false, error: { type: 'stt_failed', message: `HTTP ${response.status}` } };
      }

      const data: any = await response.json();
      const text = data?.transcript || data?.text || data?.results?.[0]?.alternatives?.[0]?.transcript || data?.output || null;
      if (text) return { ok: true, value: this.stripWakeWord(String(text)) };
      return { ok: false, error: { type: 'stt_failed', message: 'No transcript in STT response' } };
    } catch (error) {
      return { ok: false, error: { type: 'stt_failed', message: error instanceof Error ? error.message : 'Unknown error' } };
    }
  }

  private stripWakeWord(text: string): string {
    const normalized = text.trim();
    if (normalized.toLowerCase().startsWith('hey ghost')) {
      return normalized.slice('hey ghost'.length).trim();
    }
    return normalized;
  }
}
