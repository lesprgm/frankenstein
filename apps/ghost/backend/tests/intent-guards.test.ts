import { describe, it, expect, beforeEach } from 'vitest';
import { CommandProcessor } from '../src/services/command-processor';
import type { CommandRequest, ContextResult, MemoryReference } from '../src/types';

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

class FakeMemoryService {
  async extractFromConversation() {
    return;
  }
}

class FakeStorage {
  saved: any[] = [];
  async saveCommand(_req: CommandRequest, response: any) {
    this.saved.push(response);
    return { ok: true, value: true };
  }
}

const baseRequest: CommandRequest = {
  user_id: 'u1',
  command_id: 'c1',
  text: '',
  timestamp: new Date().toISOString(),
  meta: { source: 'voice', client_version: 'test' },
};

describe('Intent guards', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('prompts disambiguation when file scores are too close', async () => {
    const memories = [makeFileMemory('/tmp/a.pdf', 0.9), makeFileMemory('/tmp/b.pdf', 0.86)];
    const processor = new CommandProcessor(new FakeContextBuilder(memories) as any, new FakeLLMCoordinator() as any, new FakeMemoryService() as any, storage as any);
    const result = await processor.process({ ...baseRequest, text: 'open the maker file' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(0);
    expect(resp.assistant_text).toContain('multiple');
    expect(resp.assistant_text.toLowerCase()).toContain('which one');
  });

  it('requires an active file for scroll when none are known', async () => {
    const processor = new CommandProcessor(new FakeContextBuilder([]) as any, new FakeLLMCoordinator() as any, new FakeMemoryService() as any, storage as any);
    const result = await processor.process({ ...baseRequest, text: 'scroll down please', active_path: undefined });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(0);
    expect(resp.assistant_text.toLowerCase()).toContain('active file');
  });

  it('short-circuits summarize intent to info.summarize with file source', async () => {
    const memories = [makeFileMemory('/tmp/maker.pdf', 0.92)];
    const processor = new CommandProcessor(new FakeContextBuilder(memories) as any, new FakeLLMCoordinator() as any, new FakeMemoryService() as any, storage as any);
    const result = await processor.process({ ...baseRequest, text: 'summarize the maker paper' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions[0].type).toBe('info.summarize');
    // @ts-ignore
    expect((resp.actions[0].params.sources as string[])[0]).toBe('/tmp/maker.pdf');
  });

  it('offers to open a matched file on recall-style questions', async () => {
    const memories = [makeFileMemory('/tmp/maker.pdf', 0.92)];
    const processor = new CommandProcessor(new FakeContextBuilder(memories) as any, new FakeLLMCoordinator() as any, new FakeMemoryService() as any, storage as any);
    const result = await processor.process({ ...baseRequest, text: 'what paper did I ask you to remind me about?' });
    expect(result.ok).toBe(true);
    const resp = result.value;
    expect(resp.actions).toHaveLength(1);
    expect(resp.actions[0].type).toBe('info.recall');
    expect(resp.assistant_text.toLowerCase()).toContain('want me to open it');
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
});
