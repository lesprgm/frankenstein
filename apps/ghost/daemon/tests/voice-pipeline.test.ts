import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VoicePipeline } from '../src/voice/voice-pipeline';
import * as recordModule from 'node-record-lpcm16';

// Mock node-record-lpcm16
vi.mock('node-record-lpcm16', () => ({
    record: vi.fn(),
    default: { record: vi.fn() }
}));

describe('VoicePipeline', () => {
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

    describe('recordBackground', () => {
        it('records audio for specified duration', async () => {
            const promise = pipeline.recordBackground(100);

            // Simulate stream events
            const onData = mockStream.on.mock.calls.find((c: any) => c[0] === 'data')[1];
            const onEnd = mockStream.on.mock.calls.find((c: any) => c[0] === 'end')[1];

            onData(Buffer.from('audio'));
            onEnd();

            const result = await promise;
            expect(result.toString()).toBe('audio');
            // Silence threshold is now 0.8 (increased to avoid background noise)
            expect(recordModule.record).toHaveBeenCalledWith(expect.objectContaining({
                silence: '0.8'
            }));
        });

        it('returns empty buffer if already recording', async () => {
            // Start a recording
            const p1 = pipeline.recordBackground(1000);

            // Try another one immediately
            const result = await pipeline.recordBackground(100);
            expect(result.length).toBe(0);

            // Cleanup p1
            const onEnd = mockStream.on.mock.calls.find((c: any) => c[0] === 'end')[1];
            onEnd();
            await p1;
        });

        it('handles errors gracefully by returning empty buffer', async () => {
            const promise = pipeline.recordBackground(100);

            const onError = mockStream.on.mock.calls.find((c: any) => c[0] === 'error')[1];
            onError(new Error('Mic error'));

            const result = await promise;
            expect(result.length).toBe(0);
        });
    });
});
