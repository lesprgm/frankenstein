import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

// Mock the API module
vi.mock('../src/api', () => ({
  __esModule: true,
  fetchDashboardData: vi.fn().mockResolvedValue({
    commands: [],
    stats: { totalCommands: 0, totalMemories: 0, successRate: 0, avgResponseTime: 0 }
  }),
  activateGhost: vi.fn().mockResolvedValue({ ok: true }),
  streamLatestCommand: vi.fn(() => () => { }), // Returns cleanup function
  fetchCommandById: vi.fn(),
  fetchExplanation: vi.fn(),
}));

// Import after mocks
import { App as DashboardHome } from '../src/App';

describe('App - Audio Visualizer', () => {
    it('shows audio visualizer when listening', async () => {
        render(
            <BrowserRouter>
                <DashboardHome />
            </BrowserRouter>
        );

        // Initially not listening
        const button = screen.getByLabelText(/start listening/i);
        expect(button.querySelector('.status-dot')).toBeInTheDocument();
        expect(button.querySelector('.audio-visualizer')).not.toBeInTheDocument();

        // Click to activate listening
        fireEvent.click(button);

        // Should show visualizer
        expect(button.querySelector('.audio-visualizer')).toBeInTheDocument();
        expect(button.querySelector('.audio-visualizer .bar')).toBeInTheDocument();
    });

    it('displays streaming text with cursor', async () => {
        const { streamLatestCommand } = await import('../src/api');

        // Mock to trigger streaming
        (streamLatestCommand as any).mockImplementation((callbacks: any) => {
            setTimeout(() => {
                callbacks.onToken('Hello');
                callbacks.onToken(' world');
            }, 0);
            return () => { };
        });

        render(
            <BrowserRouter>
                <DashboardHome />
            </BrowserRouter>
        );

        // Wait for streaming to start
        await new Promise(r => setTimeout(r, 10));

        // Should show cursor when streaming
        const cursor = document.querySelector('.cursor');
        expect(cursor).toBeInTheDocument();
    });
});
