import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhisperSTT } from '../src/voice/whisper';

class MockFormData {
  private parts: any[] = [];
  append(key: string, value: any, filename?: string) {
    this.parts.push({ key, value, filename });
  }
}

class MockBlob {
  constructor(public chunks: any[]) {}
}

describe('WhisperSTT remote calls', () => {
  const originalFetch = global.fetch;
  const originalFormData = (globalThis as any).FormData;
  const originalBlob = (globalThis as any).Blob;

  beforeEach(() => {
    (globalThis as any).FormData = MockFormData as any;
    (globalThis as any).Blob = MockBlob as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (globalThis as any).FormData = originalFormData;
    (globalThis as any).Blob = originalBlob;
    delete process.env.GEMINI_STT_ENDPOINT;
    delete process.env.GEMINI_API_KEY;
  });

  it('posts audio to Google Speech endpoint with base64 JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ alternatives: [{ transcript: 'hello world' }] }] }),
    });
    global.fetch = fetchMock as any;
    process.env.GEMINI_STT_ENDPOINT = 'https://speech.googleapis.com/v1p1beta1/speech:recognize';
    process.env.GEMINI_API_KEY = 'apikey';

    const stt = new WhisperSTT('apikey', { provider: 'google' });
    const res = await stt.transcribe(Buffer.from('audio'));
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('speech.googleapis.com');
  });
});
