import type { Action, ActionResult } from '../types';
import type { TextToSpeech } from '../tts';

/**
 * Voice response templates for action feedback
 */
const RESPONSE_TEMPLATES = {
    // Success responses
    FILE_OPENED: (filename: string) => `Opening ${filename}`,
    SCROLL_SUCCESS: (direction: string) => `Scrolling ${direction}`,
    INFO_RECALLED: () => "Here's what I found",

    // Error responses
    FILE_NOT_FOUND: (filename: string) => `Sorry, I couldn't find ${filename}`,
    PATH_INVALID: () => "That path doesn't exist",
    ACTION_FAILED: (type: string) => `Sorry, ${type} failed`,

    // Disambiguation
    MULTIPLE_OPTIONS: (options: string[]) =>
        `Did you mean ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}?`,

    // Generic
    DONE: () => 'Done',
    WORKING: () => 'One moment',
};

/**
 * Service for generating natural voice responses to actions
 */
export class VoiceFeedbackService {
    constructor(private tts: TextToSpeech) { }

    /**
     * Provide voice feedback for an action result
     */
    async provideFeedback(action: Action, result: ActionResult): Promise<void> {
        const feedback = this.generateFeedback(action, result);
        if (!feedback) return;

        try {
            await this.tts.speakQueued(feedback);
        } catch (error) {
            console.error('[Ghost][VoiceFeedback] Failed to speak:', error);
        }
    }

    /**
     * Speak a confirmation before executing an action (optional)
     */
    async confirmAction(action: Action): Promise<void> {
        const confirmation = this.generateConfirmation(action);
        if (!confirmation) return;

        try {
            await this.tts.speakQueued(confirmation);
        } catch (error) {
            console.error('[Ghost][VoiceFeedback] Failed to confirm:', error);
        }
    }

    /**
     * Get instant acknowledgment for an action (micro-feedback to reduce perceived latency)
     */
    getAcknowledgment(action: Action): string | null {
        switch (action.type) {
            case 'file.open':
                return 'Opening...';
            case 'file.scroll':
                return 'Scrolling...';
            case 'info.recall':
                return 'Recalling...';
            case 'info.summarize':
                return 'Analyzing...';
            case 'reminder.create':
                return 'Noted.';
            case 'search.query':
                return 'Searching...';
            case 'file.index':
                return 'Indexing...';
            default:
                return 'On it.';
        }
    }


    /**
     * Generate feedback text for an action result
     */
    private generateFeedback(action: Action, result: ActionResult): string | null {
        if (result.status === 'success') {
            return this.generateSuccessFeedback(action);
        } else {
            return this.generateErrorFeedback(action, result);
        }
    }

    /**
     * Generate success feedback
     */
    private generateSuccessFeedback(action: Action): string | null {
        switch (action.type) {
            case 'file.open': {
                const path = action.params.path as string;
                const filename = this.extractFilename(path);
                return RESPONSE_TEMPLATES.FILE_OPENED(filename);
            }

            case 'file.scroll': {
                const direction = (action.params.direction as string) || 'down';
                return RESPONSE_TEMPLATES.SCROLL_SUCCESS(direction);
            }

            case 'info.recall':
                return RESPONSE_TEMPLATES.INFO_RECALLED();

            default:
                return RESPONSE_TEMPLATES.DONE();
        }
    }

    /**
     * Generate error feedback
     */
    private generateErrorFeedback(action: Action, result: ActionResult): string | null {
        if (result.error?.includes('not found')) {
            const path = action.params.path as string;
            const filename = this.extractFilename(path);
            return RESPONSE_TEMPLATES.FILE_NOT_FOUND(filename);
        }

        if (result.error?.includes('Invalid') || result.error?.includes('Path traversal')) {
            return RESPONSE_TEMPLATES.PATH_INVALID();
        }

        return RESPONSE_TEMPLATES.ACTION_FAILED(action.type);
    }

    /**
     * Generate pre-action confirmation (optional, can be disabled in config)
     */
    private generateConfirmation(action: Action): string | null {
        // Only confirm potentially destructive actions
        // For now, we don't pre-confirm anything (feedback after execution is enough)
        return null;
    }

    /**
     * Extract readable filename from path
     */
    private extractFilename(path: string): string {
        // Remove common directory prefixes for brevity
        const cleaned = path
            .replace(/^\/Users\/[^/]+\//, '') // Remove /Users/username/
            .replace(/\/Downloads$/, 'Downloads')
            .replace(/\/Documents$/, 'Documents')
            .replace(/\/Desktop$/, 'Desktop');

        // If it's a file, get just the filename
        if (cleaned.includes('.')) {
            const parts = cleaned.split('/');
            return parts[parts.length - 1];
        }

        return cleaned;
    }

    /**
     * Speak disambiguation options when multiple matches exist
     */
    async disambiguate(options: string[]): Promise<void> {
        if (options.length === 0) return;
        if (options.length === 1) {
            await this.tts.speakQueued(options[0]);
            return;
        }

        const feedback = RESPONSE_TEMPLATES.MULTIPLE_OPTIONS(options);
        await this.tts.speakQueued(feedback);
    }

    /**
     * Read a summary aloud with intelligent truncation
     */
    async readSummary(summary: string, maxLength = 500): Promise<void> {
        // Remove file paths and titles (common pattern: "filename.ext: content")
        let text = summary.replace(/^[^\s]+\.(txt|md|pdf|doc|docx|json|py|js|ts|tsx|jsx|html|css):\s*/i, '');

        // Remove URLs
        text = text.replace(/https?:\/\/[^\s]+/g, '');

        // If still too long, do intelligent truncation at sentence boundary
        if (text.length > maxLength) {
            // Try to find last complete sentence within limit
            const truncated = text.substring(0, maxLength);
            const lastPeriod = truncated.lastIndexOf('.');
            const lastQuestion = truncated.lastIndexOf('?');
            const lastExclamation = truncated.lastIndexOf('!');
            const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

            if (lastSentenceEnd > maxLength * 0.7) {
                // If we can get at least 70% with complete sentence, use that
                text = truncated.substring(0, lastSentenceEnd + 1);
            } else {
                // Otherwise just truncate with ellipsis
                text = truncated + '...';
            }
        }

        await this.tts.speakQueued(text);
    }
}
