import type { Action, CommandRequest, CommandResponse, LLMResponse, MemoryReference } from '../../types.js';
import type { SQLiteStorage } from '../sqlite-storage.js';
import type { PendingChoice } from './file-open-ambiguity.js';

export type RecallActionGuardDecision = {
  response: CommandResponse;
  choices: PendingChoice[];
  defaultIndex: number;
};

const OPEN_PATTERNS: RegExp[] = [
  /\bopen\b/i,
  /\bview\b/i,
  /\bshow\b/i,
  /\bdisplay\b/i,
  /\blook at\b/i,
  /\blaunch\b/i,
  /\bnavigate\b/i,
  /\bgo to\b/i,
  /\bjump to\b/i,
];

export function shouldRouteRecallActionGuard(request: CommandRequest, llmResponse: LLMResponse): boolean {
  const text = request.text || '';
  if (!OPEN_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const actions = Array.isArray(llmResponse.actions) ? llmResponse.actions : [];
  if (actions.length === 0) return false;

  const hasRecall = actions.some((action) => action.type === 'info.recall');
  if (!hasRecall) return false;

  const hasOtherAction = actions.some(
    (action) => action.type !== 'info.recall' && action.type !== 'info.summarize'
  );
  if (hasOtherAction) return false;

  return true;
}

export async function buildRecallActionGuardDecision(
  request: CommandRequest,
  llmResponse: LLMResponse,
  memories: MemoryReference[],
  storageService: SQLiteStorage
): Promise<RecallActionGuardDecision | null> {
  if (!shouldRouteRecallActionGuard(request, llmResponse)) return null;

  const summaryText = getRecallSummary(llmResponse);
  const candidates = await resolveOpenCandidates(request, memories, storageService);
  if (candidates.length === 0) return null;

  const openChoices = candidates.slice(0, 2).map((candidate) => ({
    action: { type: 'file.open', params: { path: candidate.path } } as Action,
    memories_used: candidate.memory ? [candidate.memory] : undefined,
    label: candidate.label,
  }));

  const memoriesUsed = mergeMemories(
    memories,
    candidates.map((candidate) => candidate.memory).filter(Boolean) as MemoryReference[]
  );

  const summaryChoice: PendingChoice = {
    action: {
      type: 'info.recall',
      params: { summary: summaryText || 'Here is what I found.' },
    },
    label: 'Just keep the summary',
    memories_used: memoriesUsed,
  };

  const choices = [...openChoices, summaryChoice];
  const defaultIndex = 0;

  const prompt = buildPrompt(openChoices, summaryChoice.label || 'Just keep the summary');
  const assistant_text = summaryText ? `${summaryText}\n\n${prompt}` : prompt;

  const baseActions = (llmResponse.actions || []).filter(
    (action) => action.type !== 'info.recall' && action.type !== 'file.open'
  );

  const response: CommandResponse = {
    command_id: request.command_id,
    assistant_text,
    actions: baseActions,
    memories_used: memoriesUsed,
  };

  return {
    response,
    choices,
    defaultIndex,
  };
}

export async function saveRecallActionGuardChoices(
  storageService: SQLiteStorage,
  request: CommandRequest,
  decision: RecallActionGuardDecision
): Promise<void> {
  if (typeof (storageService as any).savePendingAction !== 'function') return;
  const choices = decision.choices || [];
  if (choices.length === 0) return;

  const defaultChoice = choices[Math.min(Math.max(decision.defaultIndex, 0), choices.length - 1)] || choices[0];
  await storageService.savePendingAction(
    request.user_id,
    [defaultChoice.action],
    defaultChoice.memories_used || [],
    request.command_id,
    {
      choices,
      default_index: decision.defaultIndex,
    }
  );
}

type OpenCandidate = {
  path: string;
  label: string;
  memory?: MemoryReference;
};

async function resolveOpenCandidates(
  request: CommandRequest,
  memories: MemoryReference[],
  storageService: SQLiteStorage
): Promise<OpenCandidate[]> {
  const fileMemories = collectFileMemories(memories);
  if (fileMemories.length > 0) {
    return fileMemories.map((memory) => ({
      path: memory.metadata?.path,
      label: memory.metadata?.name || memory.metadata?.path || memory.summary,
      memory,
    })) as OpenCandidate[];
  }

  if (typeof (storageService as any).findFileByNameOrPath === 'function') {
    try {
      const matches = await (storageService as any).findFileByNameOrPath(request.text, request.user_id, 2);
      if (Array.isArray(matches) && matches.length > 0) {
        return matches.map((memory: MemoryReference) => ({
          path: memory.metadata?.path,
          label: memory.metadata?.name || memory.metadata?.path || memory.summary,
          memory,
        }));
      }
    } catch (err) {
      console.warn('[Ghost][Workflow] findFileByNameOrPath failed', err);
    }
  }

  const explicitPath = extractExplicitPath(request.text) || extractFilename(request.text) || request.active_path;
  if (explicitPath) {
    return [{ path: explicitPath, label: pickLabel(explicitPath) }];
  }

  return [];
}

function collectFileMemories(memories: MemoryReference[]): MemoryReference[] {
  const fileMemories = memories.filter((memory) => memory?.metadata?.path);
  const byPath = new Map<string, MemoryReference>();
  for (const memory of fileMemories) {
    const path = String(memory.metadata?.path || '').toLowerCase();
    if (!path) continue;
    const existing = byPath.get(path);
    if (!existing || (memory.score ?? 0) > (existing.score ?? 0)) {
      byPath.set(path, memory);
    }
  }
  return Array.from(byPath.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 2);
}

function buildPrompt(openChoices: PendingChoice[], summaryLabel: string): string {
  if (openChoices.length === 1) {
    const label = openChoices[0]?.label || 'that file';
    return `Want me to open ${label} (1) or just keep it as a summary (2)?`;
  }

  const lines = openChoices.map((choice, index) => `${index + 1}) ${choice.label || 'that file'}`);
  lines.push(`${openChoices.length + 1}) ${summaryLabel}`);
  return `Which should I open?\n${lines.join('\n')}`;
}

function getRecallSummary(llmResponse: LLMResponse): string {
  const recall = (llmResponse.actions || []).find((action) => action.type === 'info.recall');
  const summary = recall && (recall.params as any)?.summary;
  if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim();
  const assistantText = llmResponse.assistant_text || '';
  return assistantText.trim();
}

function extractExplicitPath(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(?:~\/+|\/)[^\s]+/);
  return match ? match[0] : null;
}

function extractFilename(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b[\w.-]+\.[A-Za-z0-9]{2,5}\b/);
  return match ? match[0] : null;
}

function pickLabel(path: string): string {
  if (!path) return 'that file';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function mergeMemories(primary: MemoryReference[], extra: MemoryReference[]): MemoryReference[] {
  const merged = new Map<string, MemoryReference>();
  for (const memory of [...primary, ...extra]) {
    if (!memory || !memory.id) continue;
    if (!merged.has(memory.id)) {
      merged.set(memory.id, memory);
    }
  }
  return Array.from(merged.values());
}
