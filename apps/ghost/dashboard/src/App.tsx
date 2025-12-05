import { useEffect, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { fetchDashboardData, activateGhost, streamLatestCommand } from './api';
import type { DashboardData } from './types';
import { CommandDetailView } from './views/CommandDetailView';

function DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [listeningPhase, setListeningPhase] = useState<'idle' | 'listening' | 'talking'>('idle');
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const talkTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);

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

  const clearTimers = () => {
    if (talkTimerRef.current) {
      clearTimeout(talkTimerRef.current);
      talkTimerRef.current = null;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  const toggleListening = async () => {
    try {
      const next = !listening;
      setListening(next);

      // If turning off manually, clear timers and reset phase
      if (!next) {
        clearTimers();
        setListeningPhase('idle');
        return;
      }

      setListeningPhase('listening');

      // Fire the real activation (safe if it fails; this is a demo affordance)
      activateGhost().catch(() => {
        // swallow errors for demo; UI remains
      });

      // Swap from "Listening..." to "Talking..." after a short beat and keep the waveform running
      const TALK_SWITCH_MS = 2000;
      const TOTAL_DEMO_MS = TALK_SWITCH_MS + 10000; // ~10s after the switch

      talkTimerRef.current = window.setTimeout(() => {
        setListeningPhase('talking');
      }, TALK_SWITCH_MS);

      stopTimerRef.current = window.setTimeout(() => {
        setListening(false);
        setListeningPhase('idle');
        clearTimers();
      }, TOTAL_DEMO_MS);

    } catch (error) {
      console.error('Failed to activate Ghost:', error);
      clearTimers();
      setListening(false); // Reset on error
      setListeningPhase('idle');
      setError('Failed to activate Ghost. Make sure the daemon is running.');
    }
  };

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const listeningLabel = (() => {
    if (listeningPhase === 'listening') return 'Listening...';
    if (listeningPhase === 'talking') return 'Talking...';
    return 'Ready';
  })();

  const isWaveformActive = listeningPhase !== 'idle';

  const renderStatusDot = () => {
    if (isWaveformActive) {
      return (
        <div className="audio-visualizer">
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </div>
      );
    }
    return <span className="status-dot" />;
  };

  const listeningStatusClass = listeningPhase !== 'idle' ? 'on' : 'off';

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
          className={`listen-toggle ${isWaveformActive ? 'is-active' : ''}`}
          onClick={toggleListening}
          aria-label={isWaveformActive ? 'Stop listening' : 'Start listening'}
        >
          {renderStatusDot()}
        </button>

        <p className={`listening-status ${listeningStatusClass}`}>
          {listeningLabel}
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
