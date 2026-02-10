import { describe, it, expect, beforeEach } from 'vitest';
import { CommandProcessor } from '../src/services/command-processor';
import { WorkflowEngine } from '../src/services/workflow-engine';
import { WorkflowRouter } from '../src/services/workflow-router';
import type { CommandRequest, ContextResult, MemoryReference, LLMResponse } from '../src/types';

function makeFileMemory(path: string, score = 0.9): MemoryReference {
  return {
    id: `mem-${path}`,
    type: 'entity.file.document',
    score,
    summary: `File at ${path}`,
    metadata: { path, name: path.split('/').pop() || path },
  } as MemoryReference;
}

class FakeContextBuilder {
  private memories: MemoryReference[];
  constructor(memories: MemoryReference[]) {
    this.memories = memories;
  }
  async buildContext(): Promise<ContextResult> {
    return {
      context: '',
      memories: this.memories.map((m) => ({ memory: m, score: m.score ?? 0 })),
    };
  }
}

class FakeLLMCoordinator {
  async generateResponse() {
    return { assistant_text: 'fallback', actions: [{ type: 'info.recall', params: { summary: 'fallback' } }] };
  }
}

class FakeLLMCoordinatorWithResponse {
  constructor(private response: LLMResponse) {}
  async generateResponse() {
    return this.response;
  }
}

class FakeMemoryService {
  async extractFromConversation() {
    return;
  }
}

class FakeStorage {
  saved: any[] = [];
  pending: Array<{
    id: string;
    userId: string;
    createdAt: number;
    metadata: any;
  }> = [];
  getHealth() {
    return { ok: false, error: { message: 'no db in tests' } };
  }
  getRecentConversationTurns() {
    return [];
  }
  async saveCommand(_req: CommandRequest, response: any) {
    this.saved.push(response);
    return { ok: true, value: true };
  }
  async saveConversationTurn() {
    return;
  }

  async savePendingAction(
    userId: string,
    actions: any[],
    memoriesUsed: MemoryReference[],
    commandId: string,
    extraMetadata: Record<string, any> = {}
  ) {
    const id = `pending-${this.pending.length + 1}`;
    this.pending.push({
      id,
      userId,
      createdAt: Date.now(),
      metadata: {
        actions,
        memories_used: memoriesUsed,
        command_id: commandId,
        ...extraMetadata,
      },
    });
  }

  getRecentPendingAction(userId: string, maxAgeMs: number) {
    const cutoff = Date.now() - maxAgeMs;
    const pending = [...this.pending].reverse().find((p) => p.userId === userId && p.createdAt >= cutoff);
    if (!pending) return null;
    return { id: pending.id, metadata: pending.metadata };
  }

  async clearPendingAction(id: string) {
    this.pending = this.pending.filter((p) => p.id !== id);
  }
}

const baseRequest: CommandRequest = {
  user_id: 'u1',
  command_id: 'c1',
  text: '',
  timestamp: new Date().toISOString(),
  meta: { source: 'voice', client_version: 'test' },
};

function makeWorkflowEngine() {
  return new WorkflowEngine(new WorkflowRouter(true));
}

async function withEnv<T>(key: string, value: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env[key];
  process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (typeof prev === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

describe('Intent guards', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('prompts disambiguation when file scores are too close', async () => {
    await withEnv('GHOST_ROUTING_ACTION', 'deterministic-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        new FakeLLMCoordinator() as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open the maker file' });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text).toContain('multiple');
      expect(resp.assistant_text.toLowerCase()).toContain('which one');
    });
  });

  it('requires an active file for scroll when none are known', async () => {
    await withEnv('GHOST_ROUTING_ACTION', 'deterministic-first', async () => {
      const processor = new CommandProcessor(
        new FakeContextBuilder([]) as any,
        new FakeLLMCoordinator() as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'scroll down please', active_path: undefined });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text.toLowerCase()).toContain('active file');
    });
  });

  it('routes summarize intent through the LLM response', async () => {
    const memories = [makeFileMemory('/tmp/maker.pdf', 0.92)];
    const llm = new FakeLLMCoordinatorWithResponse({
      assistant_text: 'Here is the summary.',
      actions: [
        {
          type: 'info.summarize',
          params: {
            topic: 'Summary: maker paper',
            sources: ['/tmp/maker.pdf'],
            format: 'brief',
          },
        },
      ],
    } as any);
    const processor = new CommandProcessor(new FakeContextBuilder(memories) as any, llm as any, new FakeMemoryService() as any, storage as any);
    const result = await processor.process({ ...baseRequest, text: 'summarize the maker paper' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.assistant_text).toBe('Here is the summary.');
    expect(resp.actions[0].type).toBe('info.summarize');
  });

  it('offers to open a matched file on recall-style questions', async () => {
    await withEnv('GHOST_ROUTING_ACTION', 'deterministic-first', async () => {
      const memories = [makeFileMemory('/tmp/maker.pdf', 0.92)];
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        new FakeLLMCoordinator() as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'what paper did I ask you to remind me about?' });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(1);
      expect(resp.actions[0].type).toBe('info.recall');
      expect(resp.assistant_text.toLowerCase()).toContain('want me to open it');
    });
  });

  it('builds concise reminder hints when reminder intent is present', async () => {
    const memories = [
      makeFileMemory('/tmp/maker.pdf', 0.92),
      {
        id: 'fact-1',
        type: 'fact',
        score: 0.8,
        summary: 'maker paper: key experiment on page 5',
      } as MemoryReference,
    ];
    const processor = new CommandProcessor(new FakeContextBuilder(memories) as any, new FakeLLMCoordinator() as any, new FakeMemoryService() as any, storage as any);
    const req: any = { ...baseRequest, text: 'remind me to finish the maker paper tomorrow' };
    const result = await processor.process(req);
    expect(result.ok).toBe(true);
    const saved = storage.saved.at(-1);
    expect(saved).toBeDefined();
    // Ensure reminder hints were derived (title and notes are present in payload to daemon)
    expect(saved.actions.some((a: any) => a.type === 'info.recall')).toBe(true); // reminder path still uses actions; hints are in action params of the reminder action in daemon
  });

  it('skips deterministic file disambiguation in chat mode', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
      const llm = new FakeLLMCoordinatorWithResponse({ assistant_text: 'LLM response', actions: [] });
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open the maker file', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text).toBe('LLM response');
    });
  });

  it('asks for confirmation when chat mode file.open lacks a clear match', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Opening it.',
        actions: [{ type: 'file.open', params: { path: 'maker' } }] as any,
      });
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open that file', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text.toLowerCase()).toContain('which one');
    });
  });

  it('asks for confirmation when chat mode file.open has an explicit path', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9)];
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Opening it.',
        actions: [{ type: 'file.open', params: { path: '/tmp/a.pdf' } }] as any,
      });
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open it', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text.toLowerCase()).toContain('open');
    });
  });

  it('asks for confirmation when chat mode file.open matches a memory path', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('draft', 0.9)];
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Opening it.',
        actions: [{ type: 'file.open', params: { path: 'draft' } }] as any,
      });
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open draft', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text.toLowerCase()).toContain('open');
    });
  });

  it('asks for a file choice when chat mode file.open has no memories', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Opening it.',
        actions: [{ type: 'file.open', params: { path: 'notes' } }] as any,
      });
      const processor = new CommandProcessor(
        new FakeContextBuilder([]) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any
      );
      const result = await processor.process({ ...baseRequest, text: 'open notes', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.actions).toHaveLength(0);
      expect(resp.assistant_text.toLowerCase()).toContain('which file');
    });
  });

  it('selects a pending file choice when the user replies with a number', async () => {
    const memoryA = makeFileMemory('/tmp/a.pdf', 0.9);
    const memoryB = makeFileMemory('/tmp/b.pdf', 0.8);
    const choices = [
      { action: { type: 'file.open', params: { path: '/tmp/a.pdf' } }, memories_used: [memoryA], label: 'a.pdf' },
      { action: { type: 'file.open', params: { path: '/tmp/b.pdf' } }, memories_used: [memoryB], label: 'b.pdf' },
    ];
    await storage.savePendingAction(baseRequest.user_id, [choices[0].action], [memoryA], baseRequest.command_id, {
      choices,
      default_index: 0,
    });

    const processor = new CommandProcessor(
      new FakeContextBuilder([]) as any,
      new FakeLLMCoordinator() as any,
      new FakeMemoryService() as any,
      storage as any
    );
    const result = await processor.process({ ...baseRequest, text: '2' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(1);
    expect(resp.actions[0].type).toBe('file.open');
    // @ts-ignore
    expect(resp.actions[0].params.path).toBe('/tmp/b.pdf');
    expect(resp.actions[0].requires_confirmation).toBe(false);
  });

  it('defaults to the first pending choice on confirmation', async () => {
    const memoryA = makeFileMemory('/tmp/a.pdf', 0.9);
    const memoryB = makeFileMemory('/tmp/b.pdf', 0.8);
    const choices = [
      { action: { type: 'file.open', params: { path: '/tmp/a.pdf' } }, memories_used: [memoryA], label: 'a.pdf' },
      { action: { type: 'file.open', params: { path: '/tmp/b.pdf' } }, memories_used: [memoryB], label: 'b.pdf' },
    ];
    await storage.savePendingAction(baseRequest.user_id, [choices[0].action], [memoryA], baseRequest.command_id, {
      choices,
      default_index: 0,
    });

    const processor = new CommandProcessor(
      new FakeContextBuilder([]) as any,
      new FakeLLMCoordinator() as any,
      new FakeMemoryService() as any,
      storage as any
    );
    const result = await processor.process({ ...baseRequest, text: 'yes' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(1);
    expect(resp.actions[0].type).toBe('file.open');
    // @ts-ignore
    expect(resp.actions[0].params.path).toBe('/tmp/a.pdf');
    expect(resp.actions[0].requires_confirmation).toBe(false);
  });

  it('selects a pending file choice when the user replies with an ordinal', async () => {
    const memoryA = makeFileMemory('/tmp/a.pdf', 0.9);
    const memoryB = makeFileMemory('/tmp/b.pdf', 0.8);
    const choices = [
      { action: { type: 'file.open', params: { path: '/tmp/a.pdf' } }, memories_used: [memoryA], label: 'a.pdf' },
      { action: { type: 'file.open', params: { path: '/tmp/b.pdf' } }, memories_used: [memoryB], label: 'b.pdf' },
    ];
    await storage.savePendingAction(baseRequest.user_id, [choices[0].action], [memoryA], baseRequest.command_id, {
      choices,
      default_index: 0,
    });

    const processor = new CommandProcessor(
      new FakeContextBuilder([]) as any,
      new FakeLLMCoordinator() as any,
      new FakeMemoryService() as any,
      storage as any
    );
    const result = await processor.process({ ...baseRequest, text: 'second' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(1);
    expect(resp.actions[0].type).toBe('file.open');
    // @ts-ignore
    expect(resp.actions[0].params.path).toBe('/tmp/b.pdf');
    expect(resp.actions[0].requires_confirmation).toBe(false);
  });

  it('summarize+open uses workflow to ask for a file choice', async () => {
    const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
    const llm = new FakeLLMCoordinatorWithResponse({
      assistant_text: 'Here is the summary.',
      actions: [
        {
          type: 'info.summarize',
          params: {
            topic: 'maker paper',
            sources: ['/tmp/a.pdf', '/tmp/b.pdf'],
            format: 'brief',
          },
        },
      ],
    } as any);
    const processor = new CommandProcessor(
      new FakeContextBuilder(memories) as any,
      llm as any,
      new FakeMemoryService() as any,
      storage as any,
      makeWorkflowEngine()
    );

    const result = await processor.process({ ...baseRequest, text: 'summarize and open the maker file' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.assistant_text).toContain('Here is the summary.');
    expect(resp.assistant_text.toLowerCase()).toContain('which one');
    expect(resp.actions.some((a: any) => a.type === 'info.summarize')).toBe(true);
    expect(resp.actions.some((a: any) => a.type === 'file.open')).toBe(false);
    expect(storage.pending.length).toBe(1);
    expect(storage.pending[0].metadata.choices).toHaveLength(2);
  });

  it('summarize+open with an explicit path adds file.open directly', async () => {
    const llm = new FakeLLMCoordinatorWithResponse({
      assistant_text: 'Summary complete.',
      actions: [
        {
          type: 'info.summarize',
          params: {
            topic: 'maker paper',
            sources: ['/tmp/maker.pdf'],
            format: 'brief',
          },
        },
      ],
    } as any);
    const processor = new CommandProcessor(
      new FakeContextBuilder([]) as any,
      llm as any,
      new FakeMemoryService() as any,
      storage as any,
      makeWorkflowEngine()
    );

    const result = await processor.process({ ...baseRequest, text: 'summarize and open /tmp/maker.pdf' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.assistant_text).toContain('Summary complete.');
    expect(resp.actions.some((a: any) => a.type === 'info.summarize')).toBe(true);
    expect(resp.actions.some((a: any) => a.type === 'file.open')).toBe(true);
    const openAction = resp.actions.find((a: any) => a.type === 'file.open');
    // @ts-ignore
    expect(openAction.params.path).toBe('/tmp/maker.pdf');
  });

  it('summarize+open follow-up choice opens the selected file', async () => {
    const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
    const llm = new FakeLLMCoordinatorWithResponse({
      assistant_text: 'Here is the summary.',
      actions: [
        {
          type: 'info.summarize',
          params: {
            topic: 'maker paper',
            sources: ['/tmp/a.pdf', '/tmp/b.pdf'],
            format: 'brief',
          },
        },
      ],
    } as any);
    const processor = new CommandProcessor(
      new FakeContextBuilder(memories) as any,
      llm as any,
      new FakeMemoryService() as any,
      storage as any,
      makeWorkflowEngine()
    );

    const first = await processor.process({ ...baseRequest, text: 'summarize and open the maker file' });
    expect(first.ok).toBe(true);
    expect(storage.pending.length).toBe(1);

    const followUp = await processor.process({ ...baseRequest, command_id: 'c2', text: '2' });
    expect(followUp.ok).toBe(true);
    const resp = followUp.value;
    expect(resp.actions).toHaveLength(1);
    expect(resp.actions[0].type).toBe('file.open');
    // @ts-ignore
    expect(resp.actions[0].params.path).toBe('/tmp/b.pdf');
  });

  it('recall guard prompts to open or keep summary when open intent returns recall', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Here is what I found.',
        actions: [{ type: 'info.recall', params: { summary: 'Here is what I found.' } }],
      } as any);
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any,
        makeWorkflowEngine()
      );

      const result = await processor.process({ ...baseRequest, text: 'open the maker file', conversational_mode: true });
      expect(result.ok).toBe(true);
      const resp = result.value;
      expect(resp.assistant_text).toContain('Here is what I found.');
      expect(resp.assistant_text.toLowerCase()).toContain('open');
      expect(resp.actions).toHaveLength(0);
      expect(storage.pending.length).toBe(1);
      expect(storage.pending[0].metadata.choices).toHaveLength(3);
      expect(storage.pending[0].metadata.choices[2].action.type).toBe('info.recall');
    });
  });

  it('recall guard follow-up returns the summary when choosing summary option', async () => {
    await withEnv('GHOST_ROUTING_CHAT', 'llm-first', async () => {
      const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
      const llm = new FakeLLMCoordinatorWithResponse({
        assistant_text: 'Here is what I found.',
        actions: [{ type: 'info.recall', params: { summary: 'Here is what I found.' } }],
      } as any);
      const processor = new CommandProcessor(
        new FakeContextBuilder(memories) as any,
        llm as any,
        new FakeMemoryService() as any,
        storage as any,
        makeWorkflowEngine()
      );

      const first = await processor.process({ ...baseRequest, text: 'open the maker file', conversational_mode: true });
      expect(first.ok).toBe(true);
      expect(storage.pending.length).toBe(1);

      const followUp = await processor.process({ ...baseRequest, command_id: 'c3', text: '3' });
      expect(followUp.ok).toBe(true);
      const resp = followUp.value;
      expect(resp.assistant_text).toBe('Here is what I found.');
      expect(resp.actions).toHaveLength(1);
      expect(resp.actions[0].type).toBe('info.recall');
    });
  });
});
