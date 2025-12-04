import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { fetchDashboardData, activateGhost, streamLatestCommand } from './api';
import type { DashboardData } from './types';
import { CommandDetailView } from './views/CommandDetailView';

function DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    fetchDashboardData(1).then(setData).catch(err => {
      console.error('Initial fetch failed', err);
      setError('Failed to connect to Ghost');
    });
  }, []);

  // Real-time SSE Stream
  useEffect(() => {
    const closeStream = streamLatestCommand({
      onToken: (token) => {
        setStreamingText(prev => (prev || '') + token);
      },
      onFinal: (command) => {
        setStreamingText(null); // Clear streaming text
        setData(prev => {
          if (!prev) {
            return {
              commands: [command],
              stats: {
                totalCommands: 1,
                avgResponseTime: 0,
                totalMemories: 0,
                successRate: 100
              }
            };
          }
          // Prepend new command if not already there
          if (prev.commands[0]?.id === command.id) return prev;
          return {
            ...prev,
            commands: [command, ...prev.commands].slice(0, 50),
            stats: {
              ...prev.stats,
              totalCommands: prev.stats.totalCommands + 1
            }
          };
        });
      },
      onError: (err) => {
        console.error('Stream error', err);
        // Don't show error to user immediately to avoid flickering on reconnects
      }
    });

    return () => closeStream();
  }, []);

  const toggleListening = async () => {
    try {
      setListening((prev) => !prev);
      if (!listening) {
        // Only call API when activating (not deactivating)
        await activateGhost();
        // Auto-turn off listening state after a timeout if no command comes in?
        // For now, let's just rely on the user or a future event to turn it off.
        // Actually, the "listening" state here is just a UI toggle for the button.
        // Ideally, the backend would tell us when it stops listening.
        setTimeout(() => setListening(false), 5000); // Reset after 5s for now
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
          {listening ? (
            <div className="audio-visualizer">
              <span className="bar"></span>
              <span className="bar"></span>
              <span className="bar"></span>
              <span className="bar"></span>
            </div>
          ) : (
            <span className="status-dot" />
          )}
        </button>

        <p className={`listening-status ${listening ? 'on' : 'off'}`}>
          {listening ? 'Listening...' : 'Ready'}
        </p>

        <p className="shortcut-hint">⌥ Space</p>
      </div>

      {(latestCommand || streamingText) && (
        <div className={`current-interaction visible`}>
          <div className="interaction-label">Latest Command</div>
          <div className="interaction-text">
            {latestCommand?.text || '...'}
          </div>
          <div className="interaction-response">
            {streamingText || latestCommand?.assistant_text || '...'}
            {streamingText && <span className="cursor">|</span>}
          </div>
        </div>
      )}

      {!latestCommand && !streamingText && !error && (
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

import { OverlayGraphView } from './views/OverlayGraphView';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardHome />} />
      <Route path="/command/:commandId" element={<CommandDetailView />} />
      <Route path="/explain/:commandId" element={<ExplainView />} />
      <Route path="/overlay/:commandId" element={<OverlayGraphView />} />
    </Routes>
  );
}
