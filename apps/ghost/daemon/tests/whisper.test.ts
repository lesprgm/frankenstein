import { describe, expect, it } from 'vitest';
import { WhisperSTT } from '../src/voice/whisper';

describe('WhisperSTT', () => {
  it('returns fallback transcript when no API key', async () => {
    const stt = new WhisperSTT(undefined);
    const res = await stt.transcribe(Buffer.from('audio'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.length).toBeGreaterThan(0);
    }
  });

  it('handles missing audio', async () => {
    const stt = new WhisperSTT(undefined);
    const res = await stt.transcribe(Buffer.alloc(0));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe('recording_timeout');
    }
  });
});
