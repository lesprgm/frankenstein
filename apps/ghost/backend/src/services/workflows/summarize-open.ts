import type { Action, CommandRequest, CommandResponse, LLMResponse, MemoryReference } from '../../types.js';
import type { SQLiteStorage } from '../sqlite-storage.js';
import { buildOpenFileAmbiguity, type OpenFileAmbiguity } from './file-open-ambiguity.js';

export type SummarizeOpenDecision = {
  response: CommandResponse;
  ambiguity?: OpenFileAmbiguity;
};

const SUMMARY_PATTERNS: RegExp[] = [
  /summarize/i,
  /\bsummary\b/i,
  /\brecap\b/i,
  /\boverview\b/i,
  /\btl;?dr\b/i,
  /\bbrief me\b/i,
  /\bcatch me up\b/i,
  /\bfill me in\b/i,
];

const OPEN_PATTERNS: RegExp[] = [
  /\bopen\b/i,
  /\bshow\b/i,
  /\bpull up\b/i,
  /\bbring up\b/i,
  /\blaunch\b/i,
];

export function shouldRouteSummarizeOpen(request: CommandRequest): boolean {
  const text = request.text || '';
  return SUMMARY_PATTERNS.some((p) => p.test(text)) && OPEN_PATTERNS.some((p) => p.test(text));
}

export async function buildSummarizeOpenDecision(
  request: CommandRequest,
  llmResponse: LLMResponse,
  memories: MemoryReference[],
  storageService: SQLiteStorage
): Promise<SummarizeOpenDecision | null> {
  if (!shouldRouteSummarizeOpen(request)) return null;

  const summaryText = (llmResponse.assistant_text || '').trim();
  const rawActions = Array.isArray(llmResponse.actions) ? llmResponse.actions : [];
  const summaryActions = rawActions.filter((action) => action.type !== 'file.open');

  const fileMatches = await resolveFileMatches(request, memories, storageService);
  const memoriesForOpen = mergeMemories(memories, fileMatches);

  const existingOpen = rawActions.find((action) => action.type === 'file.open') as Action | undefined;
  const openPathHint = existingOpen?.params && typeof (existingOpen.params as any).path === 'string'
    ? (existingOpen.params as any).path
    : extractExplicitPath(request.text) || extractFilename(request.text) || '';
  const baseOpenAction: Action = existingOpen || { type: 'file.open', params: { path: openPathHint } };
  const openAction: Action = { ...baseOpenAction, requires_confirmation: false };

  const responseForOpen: LLMResponse = {
    assistant_text: summaryText,
    actions: [...summaryActions, openAction],
  };

  const ambiguity = buildOpenFileAmbiguity(request, responseForOpen, memoriesForOpen);
  if (ambiguity) {
    const assistant_text = mergeAssistantText(summaryText, ambiguity.confirmation.assistant_text);
    const response: CommandResponse = {
      command_id: request.command_id,
      assistant_text,
      actions: summaryActions,
      memories_used: mergeMemories(memoriesForOpen, ambiguity.confirmation.memories_used || []),
    };
    return { response, ambiguity };
  }

  const response: CommandResponse = {
    command_id: request.command_id,
    assistant_text: summaryText || 'On it.',
    actions: [...summaryActions, openAction],
    memories_used: memoriesForOpen,
  };
  return { response };
}

async function resolveFileMatches(
  request: CommandRequest,
  memories: MemoryReference[],
  storageService: SQLiteStorage
): Promise<MemoryReference[]> {
  const fromContext = memories.filter((m) => m?.metadata?.path);
  if (fromContext.length > 0) return fromContext;

  if (typeof (storageService as any).findFileByNameOrPath === 'function') {
    try {
      const matches = await (storageService as any).findFileByNameOrPath(request.text, request.user_id, 3);
      if (Array.isArray(matches) && matches.length > 0) {
        return matches;
      }
    } catch (err) {
      console.warn('[Ghost][Workflow] findFileByNameOrPath failed', err);
    }
  }

  return [];
}

function extractExplicitPath(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(?:~\/|\/)[^\s]+/);
  return match ? match[0] : null;
}

function extractFilename(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b[\w.-]+\.[A-Za-z0-9]{2,5}\b/);
  return match ? match[0] : null;
}

function mergeAssistantText(summaryText: string, promptText: string): string {
  if (!summaryText) return promptText;
  if (!promptText) return summaryText;
  return `${summaryText}\n\n${promptText}`;
}

function mergeMemories(
  primary: MemoryReference[],
  extra: MemoryReference[]
): MemoryReference[] {
  const merged = new Map<string, MemoryReference>();
  for (const mem of [...primary, ...extra]) {
    if (!mem || !mem.id) continue;
    if (!merged.has(mem.id)) {
      merged.set(mem.id, mem);
    }
  }
  return Array.from(merged.values());
}
