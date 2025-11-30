/**
 * Shared types for Ghost Dashboard
 */

// API types
export interface CommandEntry {
  id: string;
  text: string;
  assistant_text: string;
  timestamp: string;
  created_at: string;
  actions: ActionResult[];
  memories_used: MemoryReference[];
}

export interface ActionResult {
  action: Action;
  status: 'success' | 'failed';
  error?: string;
  created_at: string;
}

// Export Command as an alias of CommandEntry for compatibility
export type Command = CommandEntry;


export interface Action {
  type: 'file.open' | 'file.scroll' | 'info.recall' | 'info.summarize';
  params: Record<string, any>;
}

export interface MemoryReference {
  id: string;
  type: string;
  score: number;
  summary: string;
  metadata?: Record<string, any>;
}

export interface DashboardData {
  commands: CommandEntry[];
  stats: DashboardStats;
}

export interface DashboardStats {
  totalCommands: number;
  totalMemories: number;
  successRate: number;
  avgResponseTime?: number;
}
