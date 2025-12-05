
export enum UserIntent {
    INTRODUCTION = 'introduction',
    CHAT_MODE = 'chat_mode',
    ACTION_MODE = 'action_mode',
    SCREEN_CONTEXT = 'screen_context',
    SYSTEM_CONTROL = 'system_control',
    UNKNOWN = 'unknown'
}

export class IntentClassifier {

    static classify(text: string): UserIntent {
        const lower = text.toLowerCase();

        // Introduction patterns
        const introPatterns = [
            /introduce yourself/i,
            /who are you/i,
            /what('s| is) your name/i,
            /tell me about yourself/i,
            /what can you do/i,
            /what are you/i,
        ];
        if (introPatterns.some(p => p.test(lower))) {
            return UserIntent.INTRODUCTION;
        }

        // Chat mode patterns
        const chatModePatterns = [
            /\b(chat mode|conversational mode)\b/,
            /\b(let'?s |i want to )?chat\b/,
            /\b(talk to me|have a conversation)\b/,
            /\bjust talk\b/,
            /\b(be (more )?conversational)\b/,
        ];
        if (chatModePatterns.some(p => p.test(lower))) {
            return UserIntent.CHAT_MODE;
        }

        // Action mode patterns
        const actionModePatterns = [
            /\b(action mode|command mode)\b/,
            /\b(execute|do things|take actions?)\b/,
            /\b(stop (chatting|talking))\b/,
            /\b(be (more )?productive)\b/,
        ];
        if (actionModePatterns.some(p => p.test(lower))) {
            return UserIntent.ACTION_MODE;
        }

        // Screen context patterns
        const screenPatterns = [
            /\bremind me\b/,
            /\bremember (this|that)\b/,
            /\bsave this\b/,
            /what('?s| is)? on (my |the )?screen/,
            /look(ing)? at (this|my screen|the screen)/,
            /see on screen/,
            /this screen/,
            /what('m| am) i looking at/,
            /what('s| is) this/,
            /tell me what (i'?m|i am) (looking at|seeing)/,
            /can (you |he )?tell me what/,
            /describe (this|what i see|what('s| is) on)/,
            /explain (this|what i see)/,
            /what do (you |i )?see/,
            /help me (understand|with) (this|what)/,
            /i'?m (kind of )?lost/,
            /what('s| is) (going on|happening)/,
            /analyze (this|the screen)/,
        ];
        if (screenPatterns.some(p => p.test(lower))) {
            return UserIntent.SCREEN_CONTEXT;
        }

        // System control patterns
        const systemPatterns = [
            /\b(pause|stop)( listening)?\b/,
            /\b(resume|continue)( listening)?\b/,
            /\b(help|what can i say)\b/,
            /\b(show )?commands\b/,
            /\b(mute|unmute)\b/,
            /\b(shut down|exit|quit)\b/,
        ];
        if (systemPatterns.some(p => p.test(lower))) {
            return UserIntent.SYSTEM_CONTROL;
        }

        return UserIntent.UNKNOWN;
    }

    static getIntroduction(): string {
        return "Hey, I'm Ghost. Leslie's personal AI assistant, running locally and powered by Memory Layer. I can help you find anything you're looking for—and I mean anything—help you understand concepts, and assist you with daily tasks.";
    }
}
