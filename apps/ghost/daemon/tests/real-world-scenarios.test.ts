
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActivationServer } from '../src/services/activation-server';
import { IntentClassifier, UserIntent } from '../src/voice/intent-classifier';
import http from 'http';

// Mock dependencies
const mockSpeak = vi.fn();
const mockToast = vi.fn();

// Simulate the logic in main.ts
async function handleVoiceCommand(transcript: string) {
    const intent = IntentClassifier.classify(transcript);

    if (intent === UserIntent.INTRODUCTION) {
        const text = IntentClassifier.getIntroduction();
        await mockSpeak(text);
        return { type: 'intro', text };
    }
    return { type: 'other' };
}

describe('Real-World Scenarios', () => {

    describe('Scenario 1: User Activates via Dashboard', () => {
        let server: ActivationServer;
        const PORT = 3848; // Use a different port for testing
        const mockHandleHotkey = vi.fn().mockResolvedValue(undefined);

        afterEach(() => {
            if (server) server.stop();
        });

        it('should successfully trigger Ghost when "Listen" button is clicked', async () => {
            // 1. Setup: Ghost Daemon is running with Activation Server
            server = new ActivationServer(PORT, mockHandleHotkey);
            server.start();
            await new Promise(resolve => setTimeout(resolve, 50)); // Wait for start

            // 2. Action: User clicks "Listen" on Dashboard (simulated HTTP POST)
            const response = await fetch(`http://localhost:${PORT}/activate`, {
                method: 'POST'
            });
            const data = await response.json();

            // 3. Verification: 
            // - Server returns success
            expect(response.status).toBe(200);
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
