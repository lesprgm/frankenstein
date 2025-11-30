import axios from 'axios';
import type { DashboardData, CommandEntry, Command } from './types';

const API_KEY =
  import.meta.env.VITE_API_KEY ||
  import.meta.env.VITE_GHOST_API_KEY ||
  import.meta.env.VITE_BACKEND_API_KEY ||
  'ghost-api-key-123';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 5000,
  headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
});

export async function fetchDashboardData(limit: number = 50): Promise<DashboardData> {
  const response = await client.get<DashboardData>('/api/dashboard/commands', { params: { limit } });
  return response.data;
}

/**
 * Fetch a specific command by ID
 */
export async function fetchCommandById(commandId: string): Promise<Command> {
  const response = await client.get<Command>(`/api/dashboard/commands/${commandId}`);
  return response.data;
}

export const streamLatestCommand = (callbacks: {
  onToken: (token: string) => void;
  onFinal: (command: CommandEntry) => void;
  onError: (error: any) => void;
}) => {
  let active = true;

  const connect = () => {
    const eventSource = new EventSource(`${client.defaults.baseURL}/api/command/stream/latest`);

    eventSource.onmessage = (event) => {
      if (!active) {
        eventSource.close();
        return;
      }

      try {
        const data = JSON.parse(event.data);
        if (data.type === 'token') {
          callbacks.onToken(data.content);
        } else if (data.type === 'final') {
          callbacks.onFinal(data.content);
          // Don't close, keep listening for next command
        } else if (data.type === 'ping') {
          // heartbeat
        }
      } catch (err) {
        console.error('Stream parse error', err);
      }
    };

    eventSource.onerror = (err) => {
      if (active) {
        console.error('EventSource error', err);
        callbacks.onError(err);
        eventSource.close();
        // Retry after delay
        setTimeout(connect, 3000);
      }
    };

    return () => {
      active = false;
      eventSource.close();
    };
  };

  const cleanup = connect();
  return cleanup;
};

export const fetchExplanation = async (commandId: string) => {
  const response = await client.get(`/api/explain/${commandId}`);
  return response.data;
};

/**
 * Activate Ghost voice listening
 */
export const activateGhost = async () => {
  try {
    const response = await client.post('/api/activate');
    return response.data;
  } catch (error) {
    console.error('Failed to activate Ghost:', error);
    throw error;
  }
};
