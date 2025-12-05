import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileContentIngestor } from '../src/services/file-content-ingestor';
import { memoryLayerIntegration } from '../src/services/memory-layer-integration';

const TEST_DIR = path.join(__dirname, 'temp-ingestor');
const TEST_FILE = path.join(TEST_DIR, 'api-notes.txt');

function makeFile(body: string) {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(TEST_FILE, body, 'utf-8');
  return {
    path: TEST_FILE,
    name: 'api-notes.txt',
    modified: new Date().toISOString(),
    size: fs.statSync(TEST_FILE).size,
  };
}

describe('fileContentIngestor', () => {
  beforeEach(() => {
    process.env.DISABLE_SMART_FINGERPRINTING = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('produces doc.chunk sections with reasonable length and no filename leakage', async () => {
    const longBody = [
      'Sarah described the API redesign trade-offs in detail. She wants lighter payloads and stable mobile contracts.',
      'Michael added that GraphQL should remain for power users, but REST must be lean for mobile timelines.',
      'David suggested batching and tighter error contracts, emphasizing backward compatibility and clear versioning.',
      'The team aligned on shipping the core endpoints before April 1st to unblock the iOS revamp.',
    ].join('\n\n');

    const file = makeFile(longBody);

    // Force MemoryLayer path to return no memories so fallback drives chunking.
    memoryLayerIntegration.memoryExtractor = {
      extract: vi.fn().mockResolvedValue({ ok: true, value: { memories: [], chunkingMetadata: undefined } }),
    } as any;
    vi.spyOn(memoryLayerIntegration, 'initialize').mockResolvedValue();

    const chunks = await fileContentIngestor.extractFile(file, 'test-workspace');

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk) => {
      expect(chunk.type).toBe('doc.chunk');
      expect(chunk.summary.length).toBeGreaterThanOrEqual(120);
      expect(chunk.summary.length).toBeLessThanOrEqual(1200);
      expect(chunk.summary.includes('api-notes')).toBe(false); // no filename leakage
      expect(chunk.metadata?.chunk_index).toBeDefined();
      expect(chunk.metadata?.total_chunks).toBeDefined();
    });

    const indices = chunks.map((c) => c.metadata?.chunk_index);
    expect(indices).toEqual(indices.slice().sort((a, b) => Number(a) - Number(b)));
  });

  it('augments tiny LLM output with fallback chunks so content stays rich', async () => {
    const body = 'Short sentence about API contracts.\n\nAnother brief note on payload sizes and caching.\n\nThird note on deadlines.';
    const file = makeFile(body);

    // Simulate MemoryLayer returning a single tiny memory
    memoryLayerIntegration.memoryExtractor = {
      extract: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          memories: [{ content: 'Tiny blip', confidence: 0.9, type: 'fact' }],
          chunkingMetadata: undefined,
        },
      }),
    } as any;
    vi.spyOn(memoryLayerIntegration, 'initialize').mockResolvedValue();

    const chunks = await fileContentIngestor.extractFile(file, 'test-workspace');

    // Should include the tiny LLM chunk plus fallback chunks with substantive length
    expect(chunks.some((c) => c.summary === 'Tiny blip')).toBe(true);
    expect(chunks.some((c) => c.summary.length >= 80)).toBe(true);
    expect(chunks.every((c) => c.type === 'doc.chunk')).toBe(true);
  });
});
