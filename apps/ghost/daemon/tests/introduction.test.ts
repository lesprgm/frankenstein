
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntentClassifier, UserIntent } from '../src/voice/intent-classifier';
import { ActivationServer } from '../src/services/activation-server';
import http from 'http';

describe('IntentClassifier', () => {
    it('should classify introduction requests', () => {
        const phrases = [
            'introduce yourself',
            'who are you',
            "what's your name",
            'tell me about yourself',
            'what can you do',
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.INTRODUCTION);
        });
    });

    it('should classify chat mode requests', () => {
        const phrases = [
            'chat mode',
            "let's chat",
            'talk to me',
            'just talk',
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.CHAT_MODE);
        });
    });

    it('should classify action mode requests', () => {
        const phrases = [
            'action mode',
            'command mode',
            'stop chatting',
            'be productive',
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.ACTION_MODE);
        });
    });

    it('should classify screen context requests', () => {
        const phrases = [
            "I'm kind of lost",
            'what am I looking at',
            'explain this',
            'what is on my screen',
            "tell me what I'm looking at"
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.SCREEN_CONTEXT);
        });
    });

    it('should return correct introduction text', () => {
        const intro = IntentClassifier.getIntroduction();
        expect(intro).toContain("I'm Ghost");
        expect(intro).toContain("Memory Layer");
        expect(intro).toContain("running locally");
    });
});

describe('ActivationServer', () => {
    let server: ActivationServer;
    const PORT = 4567; // Test port

    afterEach(() => {
        if (server) {
            server.stop();
        }
    });

    it('should trigger callback on POST /activate', async () => {
        const onActivate = vi.fn().mockResolvedValue(undefined);
        server = new ActivationServer(PORT, onActivate);
        server.start();

        // Give server a moment to start
        await new Promise(resolve => setTimeout(resolve, 100));

        // Make request
        await new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: PORT,
                path: '/activate',
                method: 'POST',
            }, (res) => {
                expect(res.statusCode).toBe(200);
                resolve();
            });
            req.on('error', reject);
            req.end();
        });

        // Check callback
        expect(onActivate).toHaveBeenCalled();
    });
});
