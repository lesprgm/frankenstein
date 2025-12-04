import { VoicePipeline } from '../voice/voice-pipeline';
import { WhisperSTT } from '../voice/whisper';
import { TextToSpeech } from '../tts';
import { shell } from 'electron';

export class WakeWordService {
    private isRunning = false;
    private isPaused = false;
    private consecutiveErrors = 0;
    private readonly MAX_CONSECUTIVE_ERRORS = 3;

    constructor(
        private voicePipeline: VoicePipeline,
        private stt: WhisperSTT,
        private tts: TextToSpeech,
        private onWakeWord: () => Promise<void>
    ) { }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[WakeWord] Service started');
        this.loop().catch(err => console.error('[WakeWord] Loop error:', err));
    }

    stop() {
        this.isRunning = false;
        console.log('[WakeWord] Service stopped');
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    private async loop() {
        // Small delay to let app settle
        await new Promise(resolve => setTimeout(resolve, 2000));

        while (this.isRunning) {
            if (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            // Safety check: stop if too many consecutive errors
            if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
                console.error('[WakeWord] Too many consecutive errors, stopping service. Please check whisper configuration.');
                this.stop();
                break;
            }

            try {
                // Record for 2 seconds or until silence (0.8s threshold)
                // This awaits the RECORDING to finish, which is correct.
                const audio = await this.voicePipeline.recordBackground(2000);

                if (audio.length === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Reduced wait
                    continue;
                }

                // PROCESS ASYNCHRONOUSLY
                // Do not await transcription, so we loop back and start recording immediately.
                // This creates a "continuous" listening effect.
                this.processAudioChunk(audio).catch(err => {
                    console.error('[WakeWord] Processing error:', err);
                    this.consecutiveErrors++;
                });

            } catch (err) {
                // console.debug('[WakeWord] Loop cycle error:', err);
                this.consecutiveErrors++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async processAudioChunk(audio: Buffer) {
        if (this.isPaused) return;

        const transcript = await this.stt.transcribe(audio);

        if (!transcript.ok) {
            this.consecutiveErrors++;
            return;
        }

        // Successfully transcribed - reset error counter
        this.consecutiveErrors = 0;

        if (transcript.ok && transcript.value) {
            const text = transcript.value.toLowerCase().trim();

            // Debug log for background audio
            if (text.length > 0) {
                console.log('[WakeWord] Heard:', text);
            }

            if (this.isWakeWord(text)) {
                console.log('[WakeWord] Wake word detected!');

                // Feedback
                await this.tts.speak('Mhmm?');

                // Trigger callback
                // We pause the loop while the callback runs (main command flow)
                this.pause();
                try {
                    await this.onWakeWord();
                } finally {
                    this.resume();
                }
            }
        }
    }

    private isWakeWord(text: string): boolean {
        const lower = text.toLowerCase();

        // Filter known hallucinations
        if (lower.includes('thanks for watching') ||
            lower.includes('subscribe') ||
            lower.includes('like and subscribe') ||
            lower.length < 5) { // Filter very short noise
            return false;
        }

        // Check for wake word variants
        // Whisper often adds punctuation
        return lower.includes('hey ghost') ||
            lower.includes('hey, ghost') ||
            lower.includes('hi ghost') ||
            lower.includes('hi, ghost') ||
            lower.includes('okay ghost') ||
            lower.includes('hello ghost');
    }
}
