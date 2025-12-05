
import * as recordModule from 'node-record-lpcm16';
import { BrowserWindow } from 'electron';
import { showOverlayToast } from '../services/overlay-notifier';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ort from 'onnxruntime-node';

// @ts-ignore
import { Silero } from '@ricky0123/vad-node/dist/_common/models';
// @ts-ignore
import { FrameProcessor } from '@ricky0123/vad-node/dist/_common/frame-processor';

/**
 * Handles microphone recording with Neural VAD (Silero) for low-latency end-of-speech detection.
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

    // --- VAD Initialization ---
    let frameProcessor: any = null;
    try {
      // Locate model manually
      let modelPath = '';
      try {
        modelPath = require.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');
      } catch (e) {
        // Fallback search
        const candidates = [
          path.resolve(__dirname, '../../node_modules/@ricky0123/vad-node/dist/silero_vad.onnx'),
          path.resolve(__dirname, '../../../../node_modules/@ricky0123/vad-node/dist/silero_vad.onnx')
        ];
        modelPath = candidates.find(p => fs.existsSync(p)) || '';
      }

      if (modelPath) {
        const modelFetcher = async () => fs.readFileSync(modelPath).buffer;
        const model = await Silero.new(ort, modelFetcher);

        frameProcessor = new FrameProcessor(model.process.bind(model), model.reset_state.bind(model), {
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          minSpeechFrames: 4,
          redemptionFrames: 8,
          preSpeechPadFrames: 3,
          frameSamples: 1536,
          submitUserSpeechOnPause: false
        });
        console.log('[VoicePipeline] Neural VAD Initialized');
      } else {
        console.warn('[VoicePipeline] VAD model not found, falling back to simple duration');
      }
    } catch (err) {
      console.error('[VoicePipeline] VAD Init Failed:', err);
    }
    // ---------------------------

    return new Promise<Buffer>((resolve, reject) => {
      let rec: any;
      let timeout: NodeJS.Timeout;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        this.isRecording = false;
        if (rec) rec.stop();
      };

      try {
        rec = recordFn({
          sampleRate: 16_000,
          threshold: 0,
          verbose: false,
          recordProgram: process.platform === 'win32' ? 'sox' : 'rec',
          endOnSilence: false,
        });
      } catch (err) {
        cleanup();
        return reject(err);
      }

      const stream = rec.stream();
      timeout = setTimeout(() => {
        console.log('[VoicePipeline] Max duration reached');
        cleanup();
        resolve(Buffer.concat(chunks));
      }, this.maxDurationMs);

      // Audio Buffer for VAD (Int16 samples)
      // Frame size: 1536 samples (3072 bytes)
      const FRAME_SIZE_SAMPLES = 1536;
      let leftover: Buffer = Buffer.alloc(0);
      let speechStarted = false;

      stream.on('data', async (data: Buffer) => {
        chunks.push(data);

        // Append to leftover
        if (!frameProcessor) return; // Skip VAD if init failed

        const totalBuffer = Buffer.concat([leftover, data]);
        let offset = 0;

        while (offset + (FRAME_SIZE_SAMPLES * 2) <= totalBuffer.length) {
          const chunkBuf = totalBuffer.slice(offset, offset + (FRAME_SIZE_SAMPLES * 2));
          offset += (FRAME_SIZE_SAMPLES * 2);

          // Convert to Float32
          const float32 = new Float32Array(FRAME_SIZE_SAMPLES);
          for (let i = 0; i < FRAME_SIZE_SAMPLES; i++) {
            float32[i] = chunkBuf.readInt16LE(i * 2) / 32768.0;
          }

          try {
            const res = await frameProcessor.process(float32);
            // res.msg might contain speech status
            // Checking internal state or msg.
            // Message is object e.g. { type: 'SPEECH_START' }?
            // checking structure
            // It seems msg has a type property or is specific class instance.
            // For safety, check frameProcessor.speaking?
            // Wait, frameProcessor has state.

            if (!speechStarted && frameProcessor.speaking) {
              speechStarted = true;
              this.showIndicator('Listening... (Speech detected)');
              console.log('[VoicePipeline] VAD: Speech Start');
            }

            if (speechStarted && !frameProcessor.speaking) {
              // Speech ended
              console.log('[VoicePipeline] VAD: Speech End');
              cleanup();
              resolve(Buffer.concat(chunks));
              return; // Stop processing loop
            }

          } catch (e) {
            console.error('VAD Processing Error', e);
          }
        }

        leftover = totalBuffer.slice(offset);
      });

      stream.on('end', () => {
        cleanup();
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (err: Error) => {
        cleanup();
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

  // Keep background recording simple (time-based)
  async recordBackground(durationMs: number = 3000): Promise<Buffer> {
    if (this.isRecording) return Buffer.alloc(0);

    this.isRecording = true;
    const recordFn = (recordModule as any).record || (recordModule as any).default;

    return new Promise<Buffer>((resolve, reject) => {
      const rec = recordFn({
        sampleRate: 16000,
        recordProgram: process.platform === 'win32' ? 'sox' : 'rec',
        endOnSilence: false
      });
      const chunks: Buffer[] = [];
      const stream = rec.stream();
      const to = setTimeout(() => rec.stop(), durationMs);

      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => {
        this.isRecording = false;
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (e: Error) => {
        this.isRecording = false;
        resolve(Buffer.alloc(0));
      });
    });
  }
}

