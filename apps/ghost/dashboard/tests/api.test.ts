import { describe, expect, it, vi, beforeEach } from 'vitest';

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('axios', () => {
  const { get } = axiosMock;
  const client = { get, defaults: { baseURL: '' } };
  return {
    __esModule: true,
    default: { create: vi.fn(() => client) },
    create: vi.fn(() => client),
  };
});

// Import after mocks to ensure axios.create is stubbed
import { fetchDashboardData, streamLatestCommand } from '../src/api';

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

  describe('streamLatestCommand', () => {
    beforeEach(() => {
      // Mock EventSource globally
      (global as any).EventSource = vi.fn();
    });

    it('connects to EventSource and handles messages', () => {
      const mockEventSource = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onerror: null as any,
        close: vi.fn(),
      };
      (global.EventSource as any).mockImplementation(() => mockEventSource);

        let tokenHandler: any;
        let finalHandler: any;
        mockEventSource.addEventListener.mockImplementation((event, handler) => {
          if (event === 'token') tokenHandler = handler;
          if (event === 'final') finalHandler = handler;
        });

      const callbacks = {
        onToken: vi.fn(),
        onFinal: vi.fn(),
        onError: vi.fn(),
      };

      const close = streamLatestCommand(callbacks);

      expect(global.EventSource).toHaveBeenCalledWith('/api/dashboard/stream-latest?apiKey=ghost-api-key-123');

      // Simulate token event
      tokenHandler({ data: JSON.stringify({ text: 'Hello' }) });
      expect(callbacks.onToken).toHaveBeenCalledWith('Hello');

      // Simulate final event
      const mockCommand = { id: '123', text: 'Hi' };
      finalHandler({ data: JSON.stringify({ command: mockCommand }) });
      expect(callbacks.onFinal).toHaveBeenCalledWith(mockCommand);

      // Cleanup
      close();
      expect(mockEventSource.close).toHaveBeenCalled();
    });

    it('handles connection errors', () => {
      const mockEventSource = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onerror: null as any,
        close: vi.fn(),
      };
      (global.EventSource as any).mockImplementation(() => mockEventSource);

      mockEventSource.addEventListener.mockImplementation(() => {});

      const callbacks = {
        onToken: vi.fn(),
        onFinal: vi.fn(),
        onError: vi.fn(),
      };

      streamLatestCommand(callbacks);

      // Simulate error
      const error = new Error('Connection failed');
      mockEventSource.onerror(error);
      expect(callbacks.onError).toHaveBeenCalledWith(error);
    });
  });
});
