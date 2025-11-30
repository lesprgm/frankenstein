import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileScanner } from '../src/files/file-scanner';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-scan-'));
const origHome = process.env.HOME;
let docs: string;
let desktop: string;
let reportPath: string;
let notesPath: string;

beforeAll(() => {
  process.env.HOME = tmpRoot;
  docs = path.join(tmpRoot, 'Documents');
  desktop = path.join(tmpRoot, 'Desktop');
  fs.mkdirSync(docs, { recursive: true });
  fs.mkdirSync(desktop, { recursive: true });
  reportPath = path.join(docs, 'report.pdf');
  notesPath = path.join(desktop, 'notes.txt');
  fs.writeFileSync(reportPath, 'pdf content');
  fs.writeFileSync(notesPath, 'text content');
  fs.writeFileSync(path.join(desktop, 'ignore.tmp'), 'tmp');

  // Ensure deterministic mtimes for latest/random checks
  const now = Date.now() / 1000;
  fs.utimesSync(reportPath, now - 60, now - 60); // older
  fs.utimesSync(notesPath, now, now); // latest
});

afterAll(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('fileScanner', () => {
  it('expands ~ paths and filters by extension', async () => {
    const results = await fileScanner.scan(['~/Documents', '~/Desktop'], {
      includeExtensions: ['pdf', 'txt'],
      maxDepth: 2,
    });
    const names = results.map((f) => path.basename(f.path));
    expect(names).toContain('report.pdf');
    expect(names).toContain('notes.txt');
    expect(names).not.toContain('ignore.tmp');
  });

  it('skips missing directories gracefully', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await fileScanner.scan(['~/Missing']);
    expect(results).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('respects limit', async () => {
    const results = await fileScanner.scan(['~/Documents', '~/Desktop'], { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('exposes cached latest and random candidates without rescanning', async () => {
    await fileScanner.scan(['~/Documents', '~/Desktop'], {
      includeExtensions: ['pdf', 'txt'],
      maxDepth: 2,
    });

    const latest = fileScanner.getLatest(1);
    expect(latest[0].path).toContain('notes.txt');

    const cached = fileScanner.getCachedFiles();
    expect(cached.length).toBeGreaterThan(0);

    const random = fileScanner.getRandom(2);
    expect(random.length).toBeGreaterThan(0);

    const stats = fileScanner.getCacheStats();
    expect(stats.count).toBe(cached.length);
    expect(stats.lastScanAt).toBeDefined();
  });
});
