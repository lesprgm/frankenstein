# Ghost Workflow Graph (Minimal Overhead)

## Goals
- Add a graph-based workflow engine for multi-step reliability.
- Preserve the fast path for simple commands.
- Minimize LLM calls and keep deterministic behavior when possible.

## Non-Goals
- Replacing the existing intent/action pipeline everywhere.
- Introducing a heavyweight workflow editor or full BPMN.
- Forcing LLM calls for every step.

## Integration Points
- Router: `apps/ghost/backend/src/services/command-processor.ts`
- Engine (new): `apps/ghost/backend/src/services/workflow-engine.ts`
- State: `fact.pending_action` metadata in `apps/ghost/backend/src/services/sqlite-storage.ts`
- LLM: `apps/ghost/backend/src/services/llm-coordinator.ts`

## Feature Flag
- `GHOST_WORKFLOW_ENABLED=true` enables workflow routing (default: off).

## High-Level Flow
1. `CommandProcessor.process()` validates input and handles pending confirmations.
2. `WorkflowRouter.route()` decides fast-path vs workflow.
3. Workflow execution either:
   - Completes and returns actions, or
   - Stores `workflow_state` in pending action metadata and asks for clarification.
4. Follow-up input resumes the workflow from saved state.

## Routing Rules (Keep It Cheap)
Fast path if:
- Single action, high confidence, no ambiguity.
- Deterministic parser match (file.open with a single candidate; reminder.create with clear title).
- Conversational response with no action intent.

Workflow path if:
- Multiple candidates or ambiguous intent.
- Missing required parameters.
- Multi-step tasks ("summarize and open", "find then explain").

## Workflow Model
```ts
export type WorkflowNodeType =
  | 'resolve_intent'
  | 'resolve_candidates'
  | 'clarify_choice'
  | 'llm_slot_fill'
  | 'execute_actions'
  | 'respond';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  next?: string;
  on?: Record<string, string>; // conditional edges
}

export interface WorkflowGraph {
  id: string;
  nodes: WorkflowNode[];
  start: string;
}
```

## State Storage (Minimal)
Reuse `fact.pending_action` metadata:
```json
{
  "workflow": {
    "graph_id": "file.open.ambiguous",
    "node_id": "clarify_choice",
    "context": { "choices": [ ... ], "default_index": 0 },
    "expires_at": "2025-01-01T00:00:00.000Z"
  }
}
```

## Example Graphs

### 1) file.open (ambiguous)
- `resolve_candidates` -> `clarify_choice` -> `execute_actions`
- Follow-up inputs supported: `1/2/3`, `first/second/third`, `yes` -> default to #1.

### 2) summarize then open
- `resolve_intent` -> `llm_slot_fill` -> `execute_actions` -> `respond`

## Latency Control
- Run deterministic parsing before LLM.
- Only call LLM when:
  - intent confidence is low,
  - required params are missing,
  - or task is multi-step.
- Cache short-term classification and slot-fill prompts.
- Combine LLM steps: "classify + extract + propose actions" in one call.
- Start file-candidate search while LLM runs.

## UX and Latency Guardrails
- Tight routing gates: enter workflow only on ambiguity, low confidence, or multi-step intent.
- One-step clarifications: ask a single high-signal choice question (2-3 options max).
- Accept shorthand replies: "1/2/3", "first/second/third", and default to #1 on "yes".
- Cap workflow depth: stop after 2-3 steps and fall back to a single action or short response.
- Parallelize data work: fetch file candidates or memories while LLM runs.
- Batch LLM work: do classify + extract + propose actions in one call when needed.
- Prefer heuristics: regex/grammar parsing for common commands before LLM.
- Observe and tune: log workflow entry rate and latency, then tighten thresholds.

## Cancel/Reset UX
- Allow simple cancels: "cancel", "never mind", "stop", "reset".
- Always confirm cancel briefly ("Okay, canceled") and clear pending workflow state.
- Auto-cancel on timeout (e.g., 2-3 minutes) with a short message if user returns later.
- If a new command starts while a workflow is pending, prioritize the new command and clear stale state.

## Fallbacks
- If LLM unavailable, use deterministic parsing + conservative clarification.
- If workflow exceeds max steps (2-3), fallback to single response or short prompt.

## Risks and Mitigations
- State drift: pending workflow state can get stale or mismatched with user intent. Mitigation: TTL on pending state, explicit cancel/reset command, and clear state after resolution.
- Concurrency: overlapping commands from voice/UI can race. Mitigation: key workflow state by `command_id` or session, and reject/merge if a newer command starts.
- Partial data: file candidates can change between steps. Mitigation: validate file exists at execution time and refresh candidates if invalid.
- Misrouting: thresholds can send too much into workflows or miss ambiguity. Mitigation: log routing decisions, add a runtime toggle, and tune thresholds based on metrics.
- LLM failure mid-workflow: can trap the user. Mitigation: deterministic fallback path and a single clarification question rather than repeated retries.
- Observability gap: hard to tell if workflow helps. Mitigation: track workflow entry rate, step count, latency, and completion rate.
- Privacy expansion: workflows may pass more context. Mitigation: minimize context in clarification steps and redact sensitive fields.
- Test gaps: multi-turn flows can break easily. Mitigation: add tests for interrupt/resume/cancel and shorthand follow-ups ("yes", "1/2/3").

## Telemetry
- Log `workflow_id`, `node_id`, step durations, and LLM usage.
- Track avg steps per command and total latency deltas.

## Phased Implementation Plan

### Phase 0: Plumbing
- Add `WorkflowRouter` and `WorkflowEngine` scaffolding.
- Add a feature flag to enable workflow routing.

### Phase 1: Two Workflows
- file.open ambiguity workflow.
- summarize -> open workflow.
- Persist state in pending action metadata.

### Phase 2: LLM Slot-Fill
- Add single LLM call for missing params in multi-step tasks.

### Phase 3: Metrics and Tuning
- Measure latency and step count. Tune thresholds.

## Testing
- Unit tests: routing rules and state transitions.
- Integration tests:
  - ambiguous file.open follow-up
  - summarize -> open
  - LLM unavailable fallback
- Ensure no duplication with existing intent-guard tests.
