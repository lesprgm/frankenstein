import * as fs from 'fs';
import * as path from 'path';

export enum UserIntent {
    INTRODUCTION = 'introduction',
    CHAT_MODE = 'chat_mode',
    ACTION_MODE = 'action_mode',
    SCREEN_CONTEXT = 'screen_context',
    SYSTEM_CONTROL = 'system_control',
    UNKNOWN = 'unknown'
}

// Define "Anchor" phrases for each intent
const INTENT_EXAMPLES = {
    [UserIntent.INTRODUCTION]: [
        "introduce yourself",
        "who are you",
        "what is your name",
        "tell me about yourself",
        "what can you do",
        "what are you"
    ],
    [UserIntent.CHAT_MODE]: [
        "chat mode",
        "conversational mode",
        "let's chat",
        "talk to me",
        "have a conversation",
        "just talk",
        "be conversational"
    ],
    [UserIntent.ACTION_MODE]: [
        "action mode",
        "command mode",
        "execute commands",
        "do things",
        "take action",
        "stop chatting",
        "be productive"
    ],
    [UserIntent.SCREEN_CONTEXT]: [
        "remind me",
        "remember this",
        "save this",
        "what is on my screen",
        "look at this",
        "see on screen",
        "what am I looking at",
        "what is this",
        "describe this",
        "explain this",
        "what do you see",
        "help me with this",
        "I'm lost",
        "what is happening",
        "analyze this",
        "solve this",
        "answer this",
        "figure this out"
    ],
    [UserIntent.SYSTEM_CONTROL]: [
        "stop listening",
        "pause listening",
        "resume listening",
        "continue listening",
        "help",
        "what can I say",
        "show commands",
        "mute",
        "unmute",
        "shut down",
        "exit",
        "quit"
    ]
};

export class IntentClassifier {
    private static embedder: any;
    private static intentEmbeddings: Record<string, number[][]> = {};

    static async init() {
        if (this.embedder) return;

        console.log("[Ghost] Initializing semantic intent classifier...");

        const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
        // Dynamic import for ESM compatibility in Electron.
        // Avoid new Function in Vitest's VM runtime.
        const { pipeline, env } = isTest
            ? await import('@xenova/transformers')
            : await (new Function('return import("@xenova/transformers")')());

        // Allow loading from local cache, but fetch remotely if missing
        env.allowLocalModels = true;
        env.useBrowserCache = false;

        // Load the same model your backend uses
        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        // Pre-calculate embeddings for our examples
        console.log("[Ghost] Pre-computing intent embeddings...");
        for (const [intent, examples] of Object.entries(INTENT_EXAMPLES)) {
            this.intentEmbeddings[intent] = [];
            for (const text of examples) {
                const output = await this.embedder(text, { pooling: 'mean', normalize: true });
                this.intentEmbeddings[intent].push(Array.from(output.data));
            }
        }
        console.log("[Ghost] Semantic classifier ready.");
    }

    static async classify(text: string): Promise<UserIntent> {
        if (!this.embedder) await this.init();

        // 1. Embed the user's input
        const output = await this.embedder(text, { pooling: 'mean', normalize: true });
        const inputVector = Array.from(output.data) as number[];

        // 2. Find the closest match
        let bestIntent = UserIntent.UNKNOWN;
        let bestScore = -1;

        for (const [intent, vectors] of Object.entries(this.intentEmbeddings)) {
            for (const vector of vectors) {
                const score = this.cosineSimilarity(inputVector, vector);
                if (score > bestScore) {
                    bestScore = score;
                    bestIntent = intent as UserIntent;
                }
            }
        }

        // Thresholds
        const MATCH_THRESHOLD = 0.4;
        const NEAR_MISS_THRESHOLD = 0.25;

        if (bestScore > MATCH_THRESHOLD) {
            return bestIntent;
        }

        if (bestScore > NEAR_MISS_THRESHOLD) {
            console.warn(`[Ghost] Near miss intent detected: "${text}" -> ${bestIntent} (score: ${bestScore.toFixed(2)})`);
            // Fire and forget (don't await) to keep UI responsive
            void this.saveSuggestion(text, bestIntent, bestScore);
        }

        return UserIntent.UNKNOWN;
    }

    private static async saveSuggestion(text: string, intent: UserIntent, score: number) {
        try {
            // Save to training-data/suggestions.json relative to CWD
            const suggestionPath = path.resolve(process.cwd(), 'apps/ghost/daemon/training-data/suggestions.json');
            
            // Ensure directory exists
            await fs.promises.mkdir(path.dirname(suggestionPath), { recursive: true });

            let suggestions: any[] = [];
            try {
                const data = await fs.promises.readFile(suggestionPath, 'utf-8');
                suggestions = JSON.parse(data);
            } catch (e: any) {
                if (e.code !== 'ENOENT') throw e;
            }

            // Avoid duplicates
            if (!suggestions.some(s => s.text === text)) {
                suggestions.push({ text, intent, score, timestamp: new Date().toISOString() });
                await fs.promises.writeFile(suggestionPath, JSON.stringify(suggestions, null, 2));
            }
        } catch (err) {
            console.warn('[Ghost] Failed to save training suggestion:', err);
        }
    }

    private static cosineSimilarity(a: number[], b: number[]) {
        return a.reduce((sum, val, i) => sum + val * b[i], 0);
    }

    static getIntroduction(): string {
        return "Hey, I'm Ghost. Leslie's personal AI assistant, running locally and powered by Memory Layer. I can help you find anything you're looking for—and I mean anything—help you understand concepts, and assist you with daily tasks.";
    }
}
