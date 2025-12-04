import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockFetch = vi.hoisted(() => ({
  fetchDashboardData: vi.fn(),
}));

vi.mock('../../src/api', () => ({
  __esModule: true,
  fetchDashboardData: mockFetch.fetchDashboardData,
  streamLatestCommand: vi.fn(() => () => { }),
  activateGhost: vi.fn(),
}));

import { App } from '../../src/App';

describe('App', () => {
  beforeEach(() => {
    mockFetch.fetchDashboardData.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders dashboard data when fetch succeeds', async () => {
    mockFetch.fetchDashboardData.mockResolvedValue({
      commands: [
        {
          id: 'cmd-1',
          text: 'open report',
          assistant_text: 'Opening report',
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          actions: [
            { action: { type: 'file.open', params: { path: '/tmp/report.pdf' } }, status: 'success', created_at: new Date().toISOString() },
          ],
          memories_used: [
            { id: 'mem-1', type: 'entity.file', score: 0.9, summary: 'Report.pdf' },
          ],
        },
      ],
      stats: { totalCommands: 1, totalMemories: 1, successRate: 1 },
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockFetch.fetchDashboardData).toHaveBeenCalled();
    });

    expect(await screen.findByText(/open report/i)).toBeInTheDocument();
    expect(screen.getByText(/Opening report/i)).toBeInTheDocument();
    // Commands appears in both the lede and stats, use getAllByText
    const commandsElements = screen.getAllByText(/Commands/i);
    expect(commandsElements.length).toBeGreaterThan(0);
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.fetchDashboardData.mockRejectedValueOnce(new Error('offline'));

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to connect to Ghost/i)).toBeInTheDocument();
    });
  });
});
