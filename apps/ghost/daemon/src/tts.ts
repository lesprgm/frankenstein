import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VoiceConfig } from './types';
import { showOverlayToast } from './services/overlay-notifier';

/**
 * TTS wrapper supporting system voices and ElevenLabs.
 */
export class TextToSpeech {
  constructor(private config: VoiceConfig) {}
  private current?: ChildProcess;
  private queue: Promise<void> = Promise.resolve();

  /**
   * Speak immediately, interrupting any current speech.
   */
  async speak(text: string): Promise<void> {
    return this.play(text, true);
  }

  /**
   * Queue speech without interrupting current playback (used for streaming/chunked TTS).
   */
  async speakQueued(text: string): Promise<void> {
    if (!text) return;
    this.queue = this.queue.then(() => this.play(text, false)).catch((err) => {
      console.error('[Ghost][TTS] Queued speech failed', err);
    });
    return this.queue;
  }

  stop(): void {
    if (this.current?.pid) {
      this.current.kill();
      this.current = undefined;
    }
  }

  private async play(text: string, interrupt: boolean): Promise<void> {
    if (!text) return;
    if (interrupt) this.stop();

    if (this.config.ttsProvider === 'elevenlabs' && this.config.ttsApiKey) {
      try {
        await this.speakWithElevenLabs(text);
        return;
      } catch (err) {
        console.error('[Ghost][TTS] ElevenLabs failed, falling back to system TTS', err);
      }
    }

    return new Promise((resolve, reject) => {
      const command = this.buildCommand(text);
      if (!command) {
        showOverlayToast('Ghost', text);
        resolve();
        return;
      }

      const [bin, ...args] = command;
      this.current = spawn(bin, args);

      this.current.on('error', reject);
      this.current.on('exit', () => resolve());
    });
  }

  private buildCommand(text: string): string[] | null {
    if (process.platform === 'darwin') return ['say', text];
    if (process.platform === 'win32') {
      const script =
        `Add-Type -AssemblyName System.Speech;` +
        `$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;` +
        `$speak.Speak('${text.replace(/'/g, "''")}');`;
      return ['powershell', '-Command', script];
    }
    // linux
    return ['espeak', text];
  }

  private async speakWithElevenLabs(text: string): Promise<void> {
    const voiceId = this.config.ttsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = this.config.ttsModelId || 'eleven_multilingual_v2';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.config.ttsApiKey || '',
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`ElevenLabs HTTP ${resp.status}: ${errText}`);
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-tts-'));
    const filePath = path.join(tmpDir, 'tts.mp3');
    fs.writeFileSync(filePath, buf);

    await new Promise<void>((resolve, reject) => {
      const player = this.buildAudioPlayer(filePath);
      if (!player) {
        return reject(new Error('No audio player available'));
      }
      const [bin, ...args] = player;
      this.current = spawn(bin, args);
      this.current.on('error', reject);
      this.current.on('exit', () => resolve());
    });
  }

  private buildAudioPlayer(file: string): string[] | null {
    if (process.platform === 'darwin') return ['afplay', file];
    if (process.platform === 'win32') {
      const script = `Add-Type -AssemblyName presentationCore;` +
        `$player = New-Object System.Windows.Media.MediaPlayer;` +
        `$player.Open('${file.replace(/'/g, "''")}');` +
        `$player.Play();` +
        `Start-Sleep -Seconds 10;`;
      return ['powershell', '-Command', script];
    }
    // linux
    return ['ffplay', '-nodisp', '-autoexit', file];
  }
}

export const createTextToSpeech = (config: VoiceConfig) => new TextToSpeech(config);
