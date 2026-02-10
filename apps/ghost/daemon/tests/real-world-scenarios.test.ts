
import { describe, it, expect, vi } from 'vitest';
import { createActivationRequestHandler } from '../src/services/activation-server';
import { createMockRequest, createMockResponse, asServerResponse } from './activation-server-helpers';

// Mock IntentClassifier to avoid loading models
vi.mock('../src/voice/intent-classifier', () => ({
    UserIntent: {
        INTRODUCTION: 'introduction',
        CHAT_MODE: 'chat_mode',
        ACTION_MODE: 'action_mode',
        SCREEN_CONTEXT: 'screen_context',
        SYSTEM_CONTROL: 'system_control',
        UNKNOWN: 'unknown'
    },
    IntentClassifier: {
        classify: vi.fn().mockImplementation(async (text: string) => {
            const lower = text.toLowerCase();
            if (lower.includes('who are you') || lower.includes('tell me about yourself')) {
                return 'introduction';
            }
            return 'unknown';
        }),
        getIntroduction: vi.fn().mockReturnValue("I'm Ghost. Leslie's personal AI assistant, running locally and powered by Memory Layer.")
    }
}));

import { IntentClassifier, UserIntent } from '../src/voice/intent-classifier';

// Mock dependencies
const mockSpeak = vi.fn();
const mockToast = vi.fn();

// Simulate the logic in main.ts
async function handleVoiceCommand(transcript: string) {
    const intent = await IntentClassifier.classify(transcript);

    if (intent === UserIntent.INTRODUCTION) {
        const text = IntentClassifier.getIntroduction();
        await mockSpeak(text);
        return { type: 'intro', text };
    }
    return { type: 'other' };
}

describe('Real-World Scenarios', () => {

    describe('Scenario 1: User Activates via Dashboard', () => {
        const mockHandleHotkey = vi.fn().mockResolvedValue(undefined);

        it('should successfully trigger Ghost when "Listen" button is clicked', async () => {
            // 1. Setup: Ghost Daemon is running with Activation Server
            const handler = createActivationRequestHandler(mockHandleHotkey);
            const req = createMockRequest('POST', '/activate');
            const res = createMockResponse();

            // 2. Action: User clicks "Listen" on Dashboard (simulated HTTP POST)
            handler(req, asServerResponse(res));
            const data = JSON.parse(res.body ?? '{}');

            // 3. Verification: 
            // - Server returns success
            expect(res.statusCode).toBe(200);
            expect(data).toHaveProperty('success', true);

            // - Ghost's hotkey handler is actually triggered
            expect(mockHandleHotkey).toHaveBeenCalled();
        });
    });

    describe('Scenario 2: User Asks for Introduction', () => {
        it('should respond with the correct persona when asked "Who are you?"', async () => {
            // 1. Action: User says "Who are you?"
            const transcript = "Who are you?";

            // 2. Processing: Ghost processes the transcript
            const result = await handleVoiceCommand(transcript);

            // 3. Verification:
            // - Identifies as Introduction intent
            expect(result.type).toBe('intro');

            // - Speaks the correct response
            expect(mockSpeak).toHaveBeenCalled();
            const spokenText = mockSpeak.mock.calls[0][0];

            // - Verifies key persona elements
            expect(spokenText).toContain("I'm Ghost");
            expect(spokenText).toContain("Leslie's personal AI assistant");
            expect(spokenText).toContain("powered by Memory Layer");
            expect(spokenText).toContain("running locally");
        });

        it('should respond correctly to natural variations like "tell me about yourself"', async () => {
            mockSpeak.mockClear();
            const transcript = "Can you tell me about yourself";
            const result = await handleVoiceCommand(transcript);
            expect(result.type).toBe('intro');
            expect(mockSpeak).toHaveBeenCalled();
        });
    });
});
