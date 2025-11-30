import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { fetchDashboardData, activateGhost } from './api';
import type { DashboardData } from './types';
import { CommandDetailView } from './views/CommandDetailView';

const POLL_INTERVAL = 5000;

function DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const payload = await fetchDashboardData(1); // Only fetch latest
        if (mounted) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Connection error');
        }
      }
    };

    load();
    const interval = setInterval(load, POLL_INTERVAL);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const toggleListening = async () => {
    try {
      setListening((prev) => !prev);
      if (!listening) {
        // Only call API when activating (not deactivating)
        await activateGhost();
      }
    } catch (error) {
      console.error('Failed to activate Ghost:', error);
      setListening(false); // Reset on error
      setError('Failed to activate Ghost. Make sure the daemon is running.');
    }
  };

  const latestCommand = data?.commands?.[0];
  const totalCommands = data?.stats?.totalCommands || 0;
  const avgResponseTime = data?.stats?.avgResponseTime || 0;

  return (
    <div className="page">
      {error && <div className="error">{error}</div>}

      <div className="hero">
        <p className="eyebrow">Ghost</p>
        <h1>Your AI Assistant</h1>
        <p className="lede">
          Press the button or use Option+Space to activate voice commands
        </p>
      </div>

      <div className="listen-controls">
        <button
          className={`listen-toggle ${listening ? 'is-active' : ''}`}
          onClick={toggleListening}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
        >
          <span className="status-dot" />
        </button>

        <p className={`listening-status ${listening ? 'on' : 'off'}`}>
          {listening ? 'Listening...' : 'Ready'}
        </p>

        <p className="shortcut-hint">⌥ Space</p>
      </div>

      {latestCommand && (
        <div className={`current-interaction ${latestCommand ? 'visible' : ''}`}>
          <div className="interaction-label">Latest Command</div>
          <div className="interaction-text">{latestCommand.text}</div>
          {latestCommand.assistant_text && (
            <div className="interaction-response">{latestCommand.assistant_text}</div>
          )}
        </div>
      )}

      {!latestCommand && !error && (
        <div className="loading">Waiting for first command</div>
      )}

      {data?.stats && (
        <div className="stats">
          <div className="stat-card">
            <span className="stat-value">{totalCommands}</span>
            <span className="stat-label">Commands</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{avgResponseTime}ms</span>
            <span className="stat-label">Response</span>
          </div>
        </div>
      )}

      {latestCommand?.memories_used && latestCommand.memories_used.length > 0 && (
        <div className="memories-indicator">
          {/* Native overlay handles the UI now */}
        </div>
      )}
    </div>
  );
}

import { ExplainView } from './views/ExplainView';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardHome />} />
      <Route path="/command/:commandId" element={<CommandDetailView />} />
      <Route path="/explain/:commandId" element={<ExplainView />} />
    </Routes>
  );
}
