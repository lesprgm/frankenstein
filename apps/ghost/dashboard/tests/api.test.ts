import { describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('axios', () => {
  const { get } = axiosMock;
  return {
    __esModule: true,
    default: { create: vi.fn(() => ({ get })) },
    create: vi.fn(() => ({ get })),
  };
});

// Import after mocks to ensure axios.create is stubbed
import { fetchDashboardData } from '../src/api';

describe('fetchDashboardData', () => {
  it('requests dashboard data with limit parameter', async () => {
    const mockData = { commands: [], stats: { totalCommands: 0, totalMemories: 0, successRate: 0 } };
    axiosMock.get.mockResolvedValueOnce({ data: mockData });

    const result = await fetchDashboardData(25);

    expect(axiosMock.get).toHaveBeenCalledWith('/api/dashboard/commands', { params: { limit: 25 } });
    expect(result).toEqual(mockData);
  });

  it('uses default limit when none provided', async () => {
    const mockData = { commands: [], stats: { totalCommands: 1, totalMemories: 2, successRate: 0.5 } };
    axiosMock.get.mockResolvedValueOnce({ data: mockData });

    const result = await fetchDashboardData();

    expect(axiosMock.get).toHaveBeenCalledWith('/api/dashboard/commands', { params: { limit: 50 } });
    expect(result).toEqual(mockData);
  });
});
