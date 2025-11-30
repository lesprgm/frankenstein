import type { MemoryReference } from '../types';

interface Props {
  memory: MemoryReference;
}

export function MemoryCard({ memory }: Props) {
  const score = Math.round(memory.score * 100);
  return (
    <div className="memory-card">
      <div className="memory-header">
        <span className="memory-type">{memory.type}</span>
        <span className="memory-score">{score}%</span>
      </div>
      <p className="memory-summary">{memory.summary}</p>
    </div>
  );
}
