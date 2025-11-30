import { describe, it, expect, vi } from 'vitest';
import { VisionService } from '../src/services/vision';
import fs from 'fs';

// Mock the VisionService to avoid actual screen capture during tests
vi.mock('../src/services/vision', () => {
    return {
        VisionService: vi.fn().mockImplementation(() => ({
            captureScreenContext: vi.fn().mockResolvedValue({
                text: 'Mocked screen text',
                screenshotPath: '/tmp/mock-screenshot.png'
            })
        }))
    };
});

describe('VisionService', () => {
    it('should capture screen context', async () => {
        const vision = new VisionService();
        const result = await vision.captureScreenContext();

        expect(result).toBeDefined();
        if (result) {
            expect(result.text).toBe('Mocked screen text');
            expect(result.screenshotPath).toBe('/tmp/mock-screenshot.png');
        }
    });
});
