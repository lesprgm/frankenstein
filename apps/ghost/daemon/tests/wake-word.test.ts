import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WakeWordService } from '../src/services/wake-word';
import { VoicePipeline } from '../src/voice/voice-pipeline';
import { WhisperSTT } from '../src/voice/whisper';
import { TextToSpeech } from '../src/tts';

describe('WakeWordService', () => {
    let service: WakeWordService;
    let mockPipeline: any;
    let mockStt: any;
    let mockTts: any;
    let mockCallback: any;

    beforeEach(() => {
        vi.useFakeTimers();

        mockPipeline = {
            recordBackground: vi.fn()
        };

        mockStt = {
            transcribe: vi.fn()
        };

        mockTts = {
            speak: vi.fn().mockResolvedValue(undefined)
        };

        mockCallback = vi.fn().mockResolvedValue(undefined);

        service = new WakeWordService(
            mockPipeline as unknown as VoicePipeline,
            mockStt as unknown as WhisperSTT,
            mockTts as unknown as TextToSpeech,
            mockCallback
        );
    });

    afterEach(() => {
        service.stop();
        vi.useRealTimers();
    });

    it('activates when "hey ghost" is detected', async () => {
        // 1. Setup mocks BEFORE start
        mockPipeline.recordBackground.mockResolvedValueOnce(Buffer.from('audio'));
        mockStt.transcribe.mockResolvedValueOnce({
            ok: true,
            value: 'hey ghost can you help me'
        });

        // 2. Start service
        service.start();

        // 3. Fast-forward initial delay (2000ms) + loop execution
        // The loop waits 2000ms, then calls recordBackground (immediate resolve), 
        // then transcribe (immediate resolve), then speaks.
        await vi.advanceTimersByTimeAsync(2100);

        // 4. Verify feedback and callback
        expect(mockTts.speak).toHaveBeenCalledWith('Mhmm?');
        expect(mockCallback).toHaveBeenCalled();
    });

    it('does not activate for random text', async () => {
        // 1. Setup mocks
        mockPipeline.recordBackground.mockResolvedValueOnce(Buffer.from('audio'));
        mockStt.transcribe.mockResolvedValueOnce({
            ok: true,
            value: 'just some random talking'
        });

        // 2. Start service
        service.start();
        await vi.advanceTimersByTimeAsync(2100);

        // 3. Verify NO activation
        expect(mockTts.speak).not.toHaveBeenCalled();
        expect(mockCallback).not.toHaveBeenCalled();
    });

    it('pauses loop while callback is running', async () => {
        // 1. Setup slow callback
        let resolveCallback: () => void;
        const callbackPromise = new Promise<void>(resolve => {
            resolveCallback = resolve;
        });
        mockCallback.mockReturnValue(callbackPromise);

        // 2. Setup mocks for activation
        mockPipeline.recordBackground.mockResolvedValueOnce(Buffer.from('audio'));
        mockStt.transcribe.mockResolvedValueOnce({ ok: true, value: 'hey ghost' });

        // 3. Start and trigger activation
        service.start();
        await vi.advanceTimersByTimeAsync(2100);

        // 4. Verify callback started
        expect(mockCallback).toHaveBeenCalled();

        // 5. Verify pipeline NOT called again yet (paused)
        mockPipeline.recordBackground.mockClear();

        // Advance time significantly - loop should be stuck awaiting callback
        await vi.advanceTimersByTimeAsync(5000);
        expect(mockPipeline.recordBackground).not.toHaveBeenCalled();

        // 6. Finish callback
        resolveCallback!();

        // 7. Verify pipeline called again (resumed)
        // We need to mock the next call to avoid unhandled rejection in the loop
        mockPipeline.recordBackground.mockResolvedValueOnce(Buffer.from(''));

        // Advance time to let loop resume - need more time for async operations
        await vi.advanceTimersByTimeAsync(2200);
        expect(mockPipeline.recordBackground).toHaveBeenCalled();
    });
});
