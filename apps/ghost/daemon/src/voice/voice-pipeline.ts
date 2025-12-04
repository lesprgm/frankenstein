import * as recordModule from 'node-record-lpcm16';
import { BrowserWindow } from 'electron';
import { showOverlayToast } from '../services/overlay-notifier';

/**
 * Handles microphone recording with simple silence detection.
 */
export class VoicePipeline {
  private isRecording = false;

  constructor(
    private silenceThreshold: number,
    private maxDurationMs: number,
    private window?: BrowserWindow
  ) { }

  async recordOnce(): Promise<Buffer> {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.isRecording = true;
    const recordFn =
      typeof (recordModule as any).record === 'function'
        ? (recordModule as any).record
        : typeof (recordModule as any).default === 'function'
          ? (recordModule as any).default
          : null;

    if (!recordFn) {
      this.isRecording = false;
      throw new Error('Audio recorder unavailable (node-record-lpcm16 export missing)');
    }

    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      let rec: any;
      try {
        rec = recordFn({
          sampleRate: 16_000,
          threshold: this.silenceThreshold,
          verbose: false,
          recordProgram: process.platform === 'win32' ? 'sox' : 'rec',
          endOnSilence: true,
          silence: '0.7',
        });
      } catch (err) {
        this.isRecording = false;
        return reject(err);
      }

      const stream = rec.stream();

      const timeout = setTimeout(() => {
        rec.stop();
      }, this.maxDurationMs);

      stream.on('data', (data: Buffer) => chunks.push(data));
      stream.on('end', () => {
        clearTimeout(timeout);
        this.isRecording = false;
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.isRecording = false;
        reject(err);
      });

      this.showIndicator('Listening...');
    });
  }

  private showIndicator(body: string): void {
    if (this.window) {
      this.window.setTitle(body);
    }
    showOverlayToast('Ghost', body);
  }
  async recordBackground(durationMs: number = 3000): Promise<Buffer> {
    if (this.isRecording) {
      // If already recording (e.g. active command), just return empty buffer to skip this cycle
      return Buffer.alloc(0);
    }

    this.isRecording = true;
    const recordFn =
      typeof (recordModule as any).record === 'function'
        ? (recordModule as any).record
        : typeof (recordModule as any).default === 'function'
          ? (recordModule as any).default
          : null;

    if (!recordFn) {
      this.isRecording = false;
      throw new Error('Audio recorder unavailable');
    }

    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      let rec: any;
      try {
        rec = recordFn({
          sampleRate: 16_000,
          threshold: this.silenceThreshold,
          verbose: false,
          recordProgram: process.platform === 'win32' ? 'sox' : 'rec',
          endOnSilence: true,
          silence: '0.8', // Increased threshold to avoid recording background noise
        });
      } catch (err) {
        this.isRecording = false;
        return reject(err);
      }

      const stream = rec.stream();

      const timeout = setTimeout(() => {
        rec.stop();
      }, durationMs);

      stream.on('data', (data: Buffer) => chunks.push(data));
      stream.on('end', () => {
        clearTimeout(timeout);
        this.isRecording = false;
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.isRecording = false;
        console.error('[VoicePipeline] Microphone error:', err);
        // Don't reject, just resolve empty to keep loop alive
        resolve(Buffer.alloc(0));
      });
    });
  }
}
