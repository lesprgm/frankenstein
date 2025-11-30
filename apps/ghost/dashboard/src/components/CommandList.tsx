import type { CommandEntry } from '../types';
import { ActionStatus } from './ActionStatus';
import { MemoryCard } from './MemoryCard';

interface Props {
  commands: CommandEntry[];
}

export function CommandList({ commands }: Props) {
  if (commands.length === 0) {
    return (
      <div className="empty">
        No commands yet. Trigger Ghost with Option+Space (or use the activation button).
      </div>
    );
  }

  return (
    <div className="command-list">
      {commands.map((cmd) => (
        <div key={cmd.id} className="command-card">
          <div className="command-meta">
            <span className="timestamp">{new Date(cmd.timestamp).toLocaleString()}</span>
            <span className="badge">v{cmd.actions.length}</span>
          </div>
          <div className="command-text">{cmd.text}</div>
          <div className="assistant-text">{cmd.assistant_text}</div>

          <div className="section">
            <div className="section-title">Memories</div>
            <div className="memory-grid">
              {cmd.memories_used.map((mem) => (
                <MemoryCard key={mem.id} memory={mem} />
              ))}
            </div>
          </div>

          <div className="section">
            <div className="section-title">Actions</div>
            <div className="actions">
              {cmd.actions.map((action, idx) => (
                <ActionStatus key={`${cmd.id}-action-${idx}`} result={action} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
