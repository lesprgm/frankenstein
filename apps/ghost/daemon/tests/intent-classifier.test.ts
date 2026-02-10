import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentClassifier, UserIntent } from '../src/voice/intent-classifier';
import { pipeline } from '@xenova/transformers';

// Mock transformers to avoid loading real models
vi.mock('@xenova/transformers', () => ({
    pipeline: vi.fn(),
    env: { allowLocalModels: false, useBrowserCache: false }
}));

describe('IntentClassifier', () => {
    let mockEmbedder: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Define orthogonal vectors for each intent category to ensure separation
        // [Screen, System, Intro, Chat, Action, Unknown]
        const VECTORS: Record<string, number[]> = {
            // SCREEN_CONTEXT anchors
            "solve this": [1, 0, 0, 0, 0, 0],
            "what is on my screen": [1, 0, 0, 0, 0, 0],
            "figure this out": [1, 0, 0, 0, 0, 0],
            
            // SCREEN_CONTEXT variations
            "can you solve this": [0.9, 0.1, 0, 0, 0, 0],
            "i am stuck on this problem": [0.95, 0.05, 0, 0, 0, 0],
            
            // SYSTEM_CONTROL anchors
            "stop listening": [0, 1, 0, 0, 0, 0],
            "shut down": [0, 1, 0, 0, 0, 0],
            
            // SYSTEM_CONTROL variations
            "please stop listening": [0.1, 0.9, 0, 0, 0, 0],
            
            // INTRODUCTION anchors
            "introduce yourself": [0, 0, 1, 0, 0, 0],
            "who are you": [0, 0, 1, 0, 0, 0],
            
            // INTRODUCTION variations
            "tell me who you are": [0, 0, 0.9, 0.1, 0, 0],

            // CHAT_MODE anchors
            "chat mode": [0, 0, 0, 1, 0, 0],
            
            // ACTION_MODE anchors
            "action mode": [0, 0, 0, 0, 1, 0],

            // UNKNOWN
            "banana": [0, 0, 0, 0, 0, 1]
        };

        mockEmbedder = vi.fn().mockImplementation(async (text: string) => {
            // Use predefined vector if available
            const key = text.toLowerCase();
            if (VECTORS[text] || VECTORS[key]) {
                 const vec = VECTORS[text] || VECTORS[key];
                 return { data: new Float32Array(vec) };
            }
            
            // Generate deterministic pseudo-random vector for unknown strings
            // so they don't all collide on the same "default" vector.
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
                hash = ((hash << 5) - hash) + text.charCodeAt(i);
                hash |= 0;
            }
            
            // Create a normalized vector based on hash
            // We use 6 dimensions to match our VECTORS
            const vec = new Float32Array(6);
            // Only fill dimensions 0-4 for random strings, leaving dimension 5 for "Unknown" (banana)
            for(let i=0; i<5; i++) {
                // Use different bits for each dimension
                const val = (hash >> (i*4)) & 0x0F; 
                vec[i] = val;
            }
            vec[5] = 0; // Explicitly 0
            
            // Normalize
            let norm = 0;
            for(let i=0; i<6; i++) norm += vec[i]*vec[i];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for(let i=0; i<6; i++) vec[i] /= norm;
            } else {
                vec[5] = 1; // Fallback
            }
            
            return { data: vec };
        });

        (pipeline as any).mockResolvedValue(mockEmbedder);
        
        (IntentClassifier as any).embedder = undefined;
        (IntentClassifier as any).intentEmbeddings = {};
    });

    it('should classify exact matches for screen context', async () => {
        const result = await IntentClassifier.classify('solve this');
        expect(result).toBe(UserIntent.SCREEN_CONTEXT);
    });

    it('should classify semantic matches for screen context', async () => {
        const result = await IntentClassifier.classify('can you solve this');
        expect(result).toBe(UserIntent.SCREEN_CONTEXT);
    });

    it('should classify semantic matches for system control', async () => {
        const result = await IntentClassifier.classify('please stop listening');
        expect(result).toBe(UserIntent.SYSTEM_CONTROL);
    });

    it('should classify introduction requests', async () => {
        const result = await IntentClassifier.classify('tell me who you are');
        expect(result).toBe(UserIntent.INTRODUCTION);
    });

    it('should return UNKNOWN for unrelated text', async () => {
        const result = await IntentClassifier.classify('banana');
        expect(result).toBe(UserIntent.UNKNOWN);
    });

    it('should return correct introduction text', () => {
        const intro = IntentClassifier.getIntroduction();
        expect(intro).toContain("I'm Ghost");
        expect(intro).toContain("Memory Layer");
        expect(intro).toContain("running locally");
    });
});
