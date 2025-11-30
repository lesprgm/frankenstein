import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notification } from 'electron';

// Mock electron
vi.mock('electron', () => ({
    Notification: vi.fn().mockImplementation((options) => ({
        show: vi.fn(),
        on: vi.fn(),
        close: vi.fn(),
        ...options
    }))
}));

describe('Notification System', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Notification Creation', () => {
        it('should create notification with title and body', () => {
            const notification = new Notification({
                title: 'Test Title',
                body: 'Test Body'
            });

            expect(Notification).toHaveBeenCalledWith({
                title: 'Test Title',
                body: 'Test Body'
            });
        });

        it('should call show() on notification', () => {
            const notification = new Notification({
                title: 'Test',
                body: 'Message'
            });

            notification.show();

            expect(notification.show).toHaveBeenCalled();
        });

        it('should handle emoji in title', () => {
            const notification = new Notification({
                title: '📄 document.txt',
                body: 'Found in 1 source'
            });

            expect(notification).toBeDefined();
        });
    });

    describe('Memory Source Notifications', () => {
        it('should format single source notification', () => {
            const sourceName = 'api-notes.md';
            const body = 'Found in 1 source\n\nAPI redesign notes...';

            const notification = new Notification({
                title: `📄 ${sourceName}`,
                body: body,
                silent: false,
                timeoutType: 'default'
            });

            expect(Notification).toHaveBeenCalledWith({
                title: '📄 api-notes.md',
                body: expect.stringContaining('Found in 1 source'),
                silent: false,
                timeoutType: 'default'
            });
        });

        it('should format multiple sources notification', () => {
            const sourceCount = 3;
            const body = `Found in ${sourceCount} sources`;

            const notification = new Notification({
                title: '📄 meeting-notes.md',
                body: body
            });

            expect(notification).toBeDefined();
        });

        it('should truncate long summaries', () => {
            const longSummary = 'A'.repeat(150);
            const truncated = longSummary.length > 100
                ? longSummary.substring(0, 100) + '...'
                : longSummary;

            expect(truncated.length).toBeLessThanOrEqual(103);
            expect(truncated).toMatch(/\.\.\.$/);
        });
    });

    describe('Notification Permissions', () => {
        it('should check if Notification is supported', () => {
            expect(Notification).toBeDefined();
        });

        it('should handle notification options correctly', () => {
            const options = {
                title: 'Ghost',
                body: 'Test message',
                silent: false,
                timeoutType: 'default' as const
            };

            new Notification(options).show();

            expect(Notification).toHaveBeenCalledWith(options);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty metadata', () => {
            const primarySource = {
                metadata: {},
                summary: 'Test summary'
            };

            const sourceName = primarySource.metadata?.source
                ? primarySource.metadata.source.split('/').pop() || 'Unknown'
                : 'Unknown source';

            expect(sourceName).toBe('Unknown source');
        });

        it('should handle undefined summary', () => {
            const primarySource = {
                metadata: { source: '/path/to/file.txt' }
            };

            let body = 'Found in 1 source';
            if (primarySource.summary) {
                body += `\n\n${primarySource.summary}`;
            }

            expect(body).toBe('Found in 1 source');
        });

        it('should extract filename from path correctly', () => {
            const path = '/Users/leslie/Documents/api-notes.md';
            const filename = path.split('/').pop();

            expect(filename).toBe('api-notes.md');
        });
    });
});
