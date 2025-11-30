import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { FileIndexRequest } from '../types.js';
import { storageService } from './storage.js';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

type IngestedMemory = {
  id: string;
  type: string;
  summary: string;
  score: number;
  metadata?: Record<string, any>;
  workspace_id: string;
  createdAt: string;
  source: 'file';
};

const SUPPORTED_EXTENSIONS = ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'css', 'html', 'pdf', 'docx', 'xlsx'];
const SIZE_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Lightweight file content ingestor for text-friendly files (txt/md).
 * Reads file contents, builds a short summary/snippet, and stores as memories
 * so summaries can draw from actual document text instead of just filenames.
 */
export class FileContentIngestor {
  async ingest(payload: FileIndexRequest): Promise<void> {
    const memories: IngestedMemory[] = [];

    for (const file of payload.files) {
      if (!this.isSupported(file.path)) continue;

      try {
        const stats = fs.statSync(file.path);
        if (stats.size > SIZE_LIMIT_BYTES) {
          console.warn('[Ghost][Ingest] Skipping large file', { path: file.path, size: stats.size });
          continue;
        }

        let raw = '';
        const ext = path.extname(file.path).toLowerCase();

        if (ext === '.pdf') {
          raw = await this.extractPdf(file.path);
        } else if (ext === '.docx') {
          raw = await this.extractDocx(file.path);
        } else if (ext === '.xlsx') {
          raw = await this.extractXlsx(file.path);
        } else {
          raw = fs.readFileSync(file.path, 'utf-8');
        }

        const summaryText = this.buildSummary(raw);
        if (!summaryText) continue;

        const fileHash = this.hashPath(path.resolve(file.path));
        const memoryId = `doc-${fileHash}`;

        memories.push({
          id: memoryId,
          type: 'fact',
          summary: `${file.name}: ${summaryText}`,
          score: 0.9,
          metadata: {
            path: file.path,
            name: file.name,
            kind: 'file.ingest',
            source_file_id: `file-${fileHash}`,
            snippet: summaryText.slice(0, 400),
          },
          workspace_id: payload.user_id,
          createdAt: new Date().toISOString(),
          source: 'file',
        });
      } catch (error) {
        console.warn('[Ghost][Ingest] Failed to ingest file', file.path, error instanceof Error ? error.message : error);
      }
    }

    if (memories.length === 0) return;

    try {
      await storageService.addMemories(memories as any);
      console.info('[Ghost][Ingest] Added memories from files', { count: memories.length });
    } catch (error) {
      console.warn('[Ghost][Ingest] Failed to store ingested memories', error instanceof Error ? error.message : error);
    }
  }

  private isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).replace('.', '').toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  }

  async extractPdf(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    return data.text;
  }

  async extractDocx(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  async extractXlsx(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_csv(sheet);
  }

  private buildSummary(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    // Increase summary window to capture more context (e.g. ~500 words)
    const words = clean.split(' ').filter(Boolean).slice(0, 500);
    return words.join(' ');
  }

  private hashPath(p: string): string {
    return crypto.createHash('md5').update(p).digest('hex');
  }
}

export const fileContentIngestor = new FileContentIngestor();
