import { Notification, shell } from 'electron';
import type { MemoryReference } from '../types';
import type { WindowManager } from '../windows/window-manager';

export interface NotificationParams {
    commandId: string;
    summary: string;
    memoryCount: number;
    primarySource?: string;
    memories?: MemoryReference[];
}

/**
 * Service for showing AI explainability notifications
 * Notifications link to the dashboard's explain view
 */
export class ExplainabilityNotifier {
    private dashboardUrl: string;
    private windowManager?: WindowManager;
    private apiKey?: string;

    constructor(dashboardUrl: string = 'http://localhost:5174', windowManager?: WindowManager, apiKey?: string) {
        this.dashboardUrl = dashboardUrl;
        this.windowManager = windowManager;
        this.apiKey = apiKey;
    }

    /**
     * Show notification explaining why Ghost retrieved specific memories
     */
    async showContextNotification(params: NotificationParams): Promise<void> {
        const { commandId, summary, memoryCount, primarySource, memories } = params;

        // Try to show overlay first if available and we have memories
        if (this.windowManager && memories && memories.length > 0) {
            try {
                // Convert memories to overlay source format
                const sources = memories.map(m => ({
                    id: m.id,
                    type: m.type,
                    score: m.score,
                    summary: m.summary,
                    metadata: m.metadata
                }));

                this.windowManager.showOverlay(sources, commandId, this.apiKey);
                return;
            } catch (err) {
                console.error('[Ghost][ExplainabilityNotifier] Failed to show overlay:', err);
            }
        }

        // Fallback to native notification - DISABLED for custom overlay demo
        /*
        const body = this.buildNotificationBody(summary, memoryCount, primarySource);

        const notification = new Notification({
            title: '🧠 Ghost Memory Recall',
            body,
            silent: false,
            urgency: 'low',
            timeoutType: 'default',
        });

        // Handle click - open dashboard with deep link
        notification.on('click', () => {
            const url = `${this.dashboardUrl}/explain/${commandId}`;
            shell.openExternal(url).catch((err) => {
                console.error('[Ghost][ExplainabilityNotifier] Failed to open URL:', err);
            });
        });

        notification.show();

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
        */
    }

    /**
     * Build notification body text
     */
    private buildNotificationBody(
        summary: string,
        memoryCount: number,
        primarySource?: string
    ): string {
        // Simple, one-line summary
        let body = summary;

        // Add memory count if > 1
        if (memoryCount > 1) {
            body += ` (${memoryCount} memories)`;
        }

        return body;
    }

    /**
     * Generate summary from memories
     */
    static generateSummary(memories: MemoryReference[]): string {
        if (memories.length === 0) return 'No memories found';

        // Use the top memory's source or content
        const topMemory = memories[0];

        // Try to extract a meaningful source
        if (topMemory.metadata?.source) {
            return `Found in ${topMemory.metadata.source}`;
        }

        // Fallback to memory type
        const typeLabel = this.formatMemoryType(topMemory.type);
        return `Retrieved from ${typeLabel}`;
    }

    /**
     * Format memory type for display
     */
    private static formatMemoryType(type: string): string {
        const labels: Record<string, string> = {
            'entity.file': 'file memories',
            'entity.person': 'person context',
            'event.meeting': 'meeting notes',
            'fact': 'knowledge base',
        };

        return labels[type] || 'memory';
    }
}
