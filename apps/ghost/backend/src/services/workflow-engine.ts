import type { CommandRequest, CommandResponse, LLMResponse, MemoryReference } from '../types.js';
import type { SQLiteStorage } from './sqlite-storage.js';
import { WorkflowRouter, type WorkflowDecision } from './workflow-router.js';
import { saveOpenChoices } from './workflows/file-open-ambiguity.js';
import { buildSummarizeOpenDecision } from './workflows/summarize-open.js';
import { buildRecallActionGuardDecision, saveRecallActionGuardChoices } from './workflows/recall-action-guard.js';

export class WorkflowEngine {
  private router: WorkflowRouter;

  constructor(router?: WorkflowRouter) {
    this.router = router || new WorkflowRouter();
  }

  async maybeHandle(
    request: CommandRequest,
    llmResponse: LLMResponse,
    memories: MemoryReference[],
    storageService: SQLiteStorage
  ): Promise<CommandResponse | null> {
    const decision = this.router.decide(request, llmResponse, memories);
    if (!decision) return null;

    return await this.handleDecision(decision, request, llmResponse, memories, storageService);
  }

  private async handleDecision(
    decision: WorkflowDecision,
    request: CommandRequest,
    llmResponse: LLMResponse,
    memories: MemoryReference[],
    storageService: SQLiteStorage
  ): Promise<CommandResponse | null> {
    if (!decision) return null;

    switch (decision.id) {
      case 'summarize.open': {
        const result = await buildSummarizeOpenDecision(
          request,
          llmResponse,
          memories,
          storageService
        );
        if (!result) return null;
        if (result.ambiguity) {
          await saveOpenChoices(storageService, request, result.ambiguity);
        }
        return result.response;
      }
      case 'recall.action.guard': {
        const result = await buildRecallActionGuardDecision(
          request,
          llmResponse,
          memories,
          storageService
        );
        if (!result) return null;
        await saveRecallActionGuardChoices(storageService, request, result);
        return result.response;
      }
      case 'file.open.ambiguous':
        await saveOpenChoices(storageService, request, decision.ambiguity);
        return decision.ambiguity.confirmation;
      default:
        return null;
    }
  }
}

export const workflowEngine = new WorkflowEngine();
