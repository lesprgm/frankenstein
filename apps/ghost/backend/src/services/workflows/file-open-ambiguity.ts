import type { Action, CommandRequest, CommandResponse, LLMResponse, MemoryReference } from '../../types.js';
import type { SQLiteStorage } from '../sqlite-storage.js';

export type PendingChoice = {
  action: Action;
  memories_used?: MemoryReference[];
  label?: string;
};

export type OpenFileAmbiguity = {
  confirmation: CommandResponse;
  choices: PendingChoice[];
  defaultIndex: number;
};

export function buildOpenFileAmbiguity(
  request: CommandRequest,
  llmResponse: LLMResponse,
  memories: MemoryReference[]
): OpenFileAmbiguity | null {
  const confirmation = buildOpenConfirmation(request, llmResponse, memories);
  if (!confirmation) return null;

  const choices = buildOpenChoices(confirmation.memories_used || []);
  return {
    confirmation,
    choices,
    defaultIndex: 0,
  };
}

export async function saveOpenChoices(
  storageService: SQLiteStorage,
  request: CommandRequest,
  ambiguity: OpenFileAmbiguity
): Promise<void> {
  if (typeof (storageService as any).savePendingAction !== 'function') return;
  const choices = ambiguity.choices || [];
  if (choices.length === 0) return;

  const defaultChoice = choices[Math.min(Math.max(ambiguity.defaultIndex, 0), choices.length - 1)] || choices[0];
  await storageService.savePendingAction(
    request.user_id,
    [defaultChoice.action],
    defaultChoice.memories_used || [],
    request.command_id,
    {
      choices,
      default_index: ambiguity.defaultIndex,
    }
  );
}

function buildOpenConfirmation(
  request: CommandRequest,
  llmResponse: LLMResponse,
  memories: MemoryReference[]
): CommandResponse | null {
  const actions = Array.isArray(llmResponse.actions) ? llmResponse.actions : [];
  const openAction = actions.find((a: any) => a?.type === 'file.open');
  if (!openAction) return null;

  const rawPath = typeof openAction?.params?.path === 'string' ? openAction.params.path.trim() : '';
  const lowerPath = rawPath.toLowerCase();
  const isCommonDir = [
    'downloads',
    'download folder',
    'download',
    'my downloads',
    'documents',
    'document folder',
    'docs',
    'desktop',
    'my desktop'
  ].includes(lowerPath);
  const pathLooksExplicit =
    !!rawPath && (/[\\/]/.test(rawPath) || rawPath.startsWith('~') || isCommonDir || /\.[A-Za-z0-9]{2,5}$/.test(rawPath));

  let fileMemories = memories.filter(
    (m) =>
      m &&
      m.metadata &&
      typeof m.metadata.path === 'string' &&
      m.metadata.path.length > 0
  );

  const byPath = new Map<string, any>();
  for (const f of fileMemories) {
    const key = f.metadata.path.toLowerCase();
    const existing = byPath.get(key);
    if (!existing || (f.score ?? 0) > (existing.score ?? 0)) {
      byPath.set(key, f);
    }
  }
  fileMemories = Array.from(byPath.values());

  const matchesPath = !!rawPath && fileMemories.some(
    (m) => m.metadata?.path?.toLowerCase() === lowerPath
  );
  if (matchesPath || pathLooksExplicit) return null;

  if (fileMemories.length === 0) {
    return {
      command_id: request.command_id,
      assistant_text: 'Which file should I open?',
      actions: [],
      memories_used: [],
    };
  }

  if (fileMemories.length === 1) {
    const file = fileMemories[0];
    const name = file.metadata?.name || file.metadata?.path || 'that file';
    return {
      command_id: request.command_id,
      assistant_text: `I found one file that might match: ${name}. Want me to open it?`,
      actions: [],
      memories_used: [file],
    };
  }

  const sorted = [...fileMemories].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
  const options = sorted.slice(0, 3).map((m: any, idx: number) => {
    const name = m.metadata?.name || m.metadata?.path || `Option ${idx + 1}`;
    return `${idx + 1}) ${name}`;
  });
  return {
    command_id: request.command_id,
    assistant_text: `I found multiple matching files. Which one should I open?\n${options.join('\n')}`,
    actions: [],
    memories_used: sorted.slice(0, 3),
  };
}

function buildOpenChoices(memories: MemoryReference[]): PendingChoice[] {
  const choices: PendingChoice[] = memories
    .map((memory) => {
      const path = memory.metadata?.path;
      if (!path || typeof path !== 'string') return null;
      return {
        action: { type: 'file.open', params: { path } },
        memories_used: [memory],
        label: memory.metadata?.name || memory.metadata?.path || memory.summary,
      } as PendingChoice;
    })
    .filter(Boolean) as PendingChoice[];

  return choices;
}
