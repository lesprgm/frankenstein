import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VoicePipeline } from '../src/voice/voice-pipeline';
import * as recordModule from 'node-record-lpcm16';

// Mock node-record-lpcm16
vi.mock('node-record-lpcm16', () => ({
    record: vi.fn(),
    default: { record: vi.fn() }
}));

describe('VoicePipeline - Barge-in', () => {
    let pipeline: VoicePipeline;
    let mockRecord: any;
    let mockStream: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockStream = {
            on: vi.fn(),
        };

        mockRecord = {
            stream: vi.fn().mockReturnValue(mockStream),
            stop: vi.fn(),
        };

        (recordModule.record as any).mockReturnValue(mockRecord);

        pipeline = new VoicePipeline(0.5, 5000);
    });

    it('should trigger callback when loud audio is detected', () => {
        const onSpeechDetected = vi.fn();
        pipeline.listenForInterruption(onSpeechDetected);

        // Get the data handler
        const onData = mockStream.on.mock.calls.find((c: any) => c[0] === 'data')[1];

        // Create a "loud" buffer (high amplitude)
        // 16-bit PCM, so max value is 32767.
        // Let's create a buffer with values around 10000 (approx 0.3 RMS, well above 0.02 threshold)
        const loudBuffer = Buffer.alloc(100);
        for (let i = 0; i < 100; i += 2) {
            loudBuffer.writeInt16LE(10000, i);
        }

        // Send enough frames to trigger (REQUIRED_FRAMES = 3)
        onData(loudBuffer);
        onData(loudBuffer);
        onData(loudBuffer);

        expect(onSpeechDetected).toHaveBeenCalled();
        expect(mockRecord.stop).toHaveBeenCalled();
    });

    it('should NOT trigger callback for silence', () => {
        const onSpeechDetected = vi.fn();
        pipeline.listenForInterruption(onSpeechDetected);

        const onData = mockStream.on.mock.calls.find((c: any) => c[0] === 'data')[1];

        // Create a "quiet" buffer
        const quietBuffer = Buffer.alloc(100);
        for (let i = 0; i < 100; i += 2) {
            quietBuffer.writeInt16LE(10, i); // Very low amplitude
        }

        // Send many frames
        for (let i = 0; i < 10; i++) {
            onData(quietBuffer);
        }

        expect(onSpeechDetected).not.toHaveBeenCalled();
        expect(mockRecord.stop).not.toHaveBeenCalled();
    });
});
