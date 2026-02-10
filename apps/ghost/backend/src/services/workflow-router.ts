import type { CommandRequest, LLMResponse, MemoryReference } from '../types.js';
import { buildOpenFileAmbiguity, type OpenFileAmbiguity } from './workflows/file-open-ambiguity.js';
import { shouldRouteSummarizeOpen } from './workflows/summarize-open.js';
import { shouldRouteRecallActionGuard } from './workflows/recall-action-guard.js';

export type WorkflowDecision =
  | { id: 'summarize.open' }
  | { id: 'recall.action.guard' }
  | { id: 'file.open.ambiguous'; ambiguity: OpenFileAmbiguity }
  | null;

export class WorkflowRouter {
  private enabled: boolean;

  constructor(enabled: boolean = isWorkflowEnabled()) {
    this.enabled = enabled;
  }

  decide(
    request: CommandRequest,
    llmResponse: LLMResponse,
    memories: MemoryReference[]
  ): WorkflowDecision {
    if (!this.enabled) return null;

    if (shouldRouteSummarizeOpen(request)) {
      return { id: 'summarize.open' };
    }

    if (shouldRouteRecallActionGuard(request, llmResponse)) {
      return { id: 'recall.action.guard' };
    }

    const ambiguity = buildOpenFileAmbiguity(request, llmResponse, memories);
    if (ambiguity) {
      return { id: 'file.open.ambiguous', ambiguity };
    }

    return null;
  }
}

function isWorkflowEnabled(): boolean {
  const raw = process.env.GHOST_WORKFLOW_ENABLED;
  if (!raw) return false;
  return raw.toLowerCase() === 'true';
}
