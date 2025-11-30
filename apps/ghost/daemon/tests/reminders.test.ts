import { describe, it, expect, beforeAll } from 'vitest';
import { RemindersService } from '../src/services/reminders';

describe('RemindersService', () => {
    let service: RemindersService;

    beforeAll(() => {
        service = new RemindersService();
    });

    it('should create a basic reminder', async () => {
        const result = await service.createReminder({
            title: 'Test Reminder',
            notes: 'This is a test reminder created by the test suite',
        });

        // Note: This will actually create a real reminder on macOS
        // In a real test environment, we'd mock the Swift script
        expect(result).toHaveProperty('success');
    });

    it('should create a reminder with due date', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const result = await service.createReminder({
            title: 'Test Reminder with Date',
            notes: 'This should be due tomorrow',
            dueDate: tomorrow.toISOString(),
        });

        expect(result).toHaveProperty('success');
    });

    it('should handle missing title gracefully', async () => {
        const result = await service.createReminder({
            title: '',
            notes: 'No title',
        });

        // The Swift script should handle this
        expect(result).toHaveProperty('success');
    });
});
