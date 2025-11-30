import type { DashboardStats } from '../types';

interface Props {
  stats: DashboardStats;
}

export function StatsPanel({ stats }: Props) {
  const items = [
    { label: 'Commands', value: stats.totalCommands },
    { label: 'Memories', value: stats.totalMemories },
    { label: 'Success Rate', value: `${Math.round((stats.successRate || 0) * 100)}%` },
  ];

  return (
    <div className="stats">
      {items.map((item) => (
        <div key={item.label} className="stat-card">
          <div className="stat-label">{item.label}</div>
          <div className="stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
