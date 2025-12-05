
import { describe, it, expect } from 'vitest';
import { IntentClassifier, UserIntent } from '../src/voice/intent-classifier';

describe('System Control Intents', () => {
    it('should classify pause/stop commands', () => {
        const phrases = [
            'pause listening',
            'stop listening',
            'pause',
            'stop',
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.SYSTEM_CONTROL);
        });
    });

    it('should classify resume commands', () => {
        const phrases = [
            'resume listening',
            'continue listening',
            'resume',
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.SYSTEM_CONTROL);
        });
    });

    it('should classify help commands', () => {
        const phrases = [
            'help',
            'what can I say',
            'show commands',
            'commands'
        ];
        phrases.forEach(phrase => {
            expect(IntentClassifier.classify(phrase)).toBe(UserIntent.SYSTEM_CONTROL);
        });
    });
});
