import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { FileIndexRequest } from '../types.js';
import { storageService } from './storage.js';
import * as XLSX from 'xlsx';
import { memoryLayerIntegration } from './memory-layer-integration.js';
import type { NormalizedConversation, NormalizedMessage } from '@memorylayer/memory-extraction';

const require = createRequire(import.meta.url);
const mammothLib = require('mammoth');
const mammoth = mammothLib.default || mammothLib;
const pdfParseLib = require('pdf-parse');
const pdfParse = pdfParseLib.default || pdfParseLib;

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
// Increased from 2MB to 10MB - parsing limit, not indexing limit
// MemoryLayer chunking will handle any size after parsing
const PARSE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * File content ingestor using MemoryLayer's chunking system.
 * 
 * Converts file contents into a "conversation" format and uses MemoryLayer's
  /**
   * File content ingestor using MemoryLayer's chunking system with smart batch processing.
   * 
   * Strategy:
   * 1. Filter files (skip code files, node_modules, small files)
   * 2. Prioritize recent files (extract top 50 immediately)
   * 3. Background extraction for remaining files (batched with delays)
   */
export class FileContentIngestor {
  // Configuration (can be overridden via env vars)
  private readonly PRIORITY_FILE_COUNT = parseInt(process.env.GHOST_EXTRACT_PRIORITY_COUNT || '50', 10);
  private readonly PRIORITY_BATCH_SIZE = 5;
  private readonly PRIORITY_BATCH_DELAY = 1000; // 1s between priority batches
  private readonly BACKGROUND_BATCH_SIZE = parseInt(process.env.GHOST_EXTRACT_BATCH_SIZE || '10', 10);
  private readonly BACKGROUND_BATCH_DELAY = parseInt(process.env.GHOST_EXTRACT_BATCH_DELAY || '2000', 10);

  // Content-rich file extensions to extract from
  private readonly CONTENT_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'];

  // Paths to exclude from extraction
  private readonly EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    '.DS_Store',
    'package-lock.json',
  ];

  async ingest(payload: FileIndexRequest): Promise<void> {
    const { priority, background } = this.prioritizeFiles(payload.files);

    console.info('[Ghost][Ingest] Smart extraction starting', {
      total: payload.files.length,
      extractable: priority.length + background.length,
      priority: priority.length,
      background: background.length,
      skipped: payload.files.length - (priority.length + background.length),
    });

    // Process priority files immediately (small batches with short delays)
    if (priority.length > 0) {
      await this.processBatch(priority, payload.user_id, {
        batchSize: this.PRIORITY_BATCH_SIZE,
        delayMs: this.PRIORITY_BATCH_DELAY,
        label: 'Priority',
      });
    }

    // Process background files asynchronously (larger batches with longer delays)
    if (background.length > 0) {
      this.processBatch(background, payload.user_id, {
        batchSize: this.BACKGROUND_BATCH_SIZE,
        delayMs: this.BACKGROUND_BATCH_DELAY,
        label: 'Background',
      }).catch((error) => {
        console.error('[Ghost][Ingest] Background processing failed', error);
      });
    }
  }

  /**
   * Check if file should be extracted based on content type and size
   */
  private shouldExtract(file: { path: string; size: number }): boolean {
    const ext = path.extname(file.path).toLowerCase();

    // Must be a content-rich file type
    if (!this.CONTENT_EXTENSIONS.includes(ext)) {
      return false;
    }

    // Must be larger than 1KB (skip tiny files)
    if (file.size <= 1024) {
      return false;
    }

    // Must not be in excluded paths
    for (const pattern of this.EXCLUDE_PATTERNS) {
      if (file.path.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Prioritize files for extraction: recent files first
   */
  private prioritizeFiles(files: any[]): {
    priority: any[];
    background: any[];
  } {
    // Filter to extractable files
    const extractable = files.filter(f => this.isSupported(f.path) && this.shouldExtract(f));

    // Sort by modified time (most recent first)
    const sorted = extractable.sort((a, b) => {
      const aTime = new Date(a.modified).getTime();
      const bTime = new Date(b.modified).getTime();
      return bTime - aTime;
    });

    return {
      priority: sorted.slice(0, this.PRIORITY_FILE_COUNT),
      background: sorted.slice(this.PRIORITY_FILE_COUNT),
    };
  }

  /**
   * Process a batch of files with rate limiting
   */
  private async processBatch(
    files: any[],
    workspaceId: string,
    options: { batchSize: number; delayMs: number; label: string }
  ): Promise<void> {
    console.info(`[Ghost][Ingest] ${options.label} extraction starting`, {
      count: files.length,
      batchSize: options.batchSize,
      estimatedTime: `${Math.ceil((files.length / options.batchSize) * (options.delayMs / 1000))}s`,
    });

    const memories: IngestedMemory[] = [];
    let processed = 0;

    // Process files in batches
    for (let i = 0; i < files.length; i += options.batchSize) {
      const batch = files.slice(i, i + options.batchSize);

      // Extract from each file in the batch
      for (const file of batch) {
        try {
          const extracted = await this.extractFile(file, workspaceId);
          memories.push(...extracted);
          processed++;
        } catch (error) {
          console.warn('[Ghost][Ingest] Failed to extract file', {
            file: file.path,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      // Progress logging every 10 files
      if (processed % 10 === 0 || processed === files.length) {
        console.info(`[Ghost][Ingest] ${options.label} progress`, {
          completed: processed,
          total: files.length,
          memories: memories.length,
        });
      }

      // Rate limit delay between batches
      if (i + options.batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs));
      }
    }

    // Store all extracted memories
    if (memories.length > 0) {
      try {
        await storageService.addMemories(memories as any);
        console.info(`[Ghost][Ingest] ${options.label} extraction complete`, {
          files: processed,
          memories: memories.length,
        });
      } catch (error) {
        console.warn(`[Ghost][Ingest] ${options.label} storage failed`, error);
      }
    } else {
      console.info(`[Ghost][Ingest] ${options.label} extraction complete (no memories extracted)`, {
        files: processed,
      });
    }
  }

  /**
   * Extract content from a single file
   */
  private async extractFile(file: any, workspaceId: string): Promise<IngestedMemory[]> {
    const stats = fs.statSync(file.path);

    // Only limit parsing size
    if (stats.size > PARSE_SIZE_LIMIT_BYTES) {
      console.warn('[Ghost][Ingest] File exceeds parse limit, will attempt chunked ingestion', {
        path: file.path,
        size: stats.size,
        limitMB: PARSE_SIZE_LIMIT_BYTES / (1024 * 1024)
      });
    }

    let raw = '';
    const ext = path.extname(file.path).toLowerCase();

    // Extract text content
    if (ext === '.pdf') {
      raw = await this.extractPdf(file.path);
    } else if (ext === '.docx') {
      raw = await this.extractDocx(file.path);
    } else if (ext === '.xlsx') {
      raw = await this.extractXlsx(file.path);
    } else {
      raw = fs.readFileSync(file.path, 'utf-8');
    }

    if (!raw || raw.trim().length === 0) {
      console.warn('[Ghost][Ingest] File has no extractable content', file.path);
      return [];
    }

    // Convert file content to conversation format for MemoryLayer
    const conversation = this.convertToConversation(raw, file.path, file.name);

    // Try MemoryLayer extraction first, fallback to simple chunking if it fails
    let extractedMemories = await this.extractWithMemoryLayer(
      conversation,
      workspaceId,
      file
    );

    // If LLM extraction failed (rate limits, etc.), use simple fallback
    if (extractedMemories.length === 0) {
      console.info('[Ghost][Ingest] Using fallback extraction (no LLM)', { file: file.name });
      extractedMemories = this.extractWithFallback(raw, file, workspaceId);
    }

    return extractedMemories;
  }

  /**
   * Fallback extraction that stores raw file content chunks without LLM.
   * Used when MemoryLayer extraction fails (e.g., rate limits).
   */
  private extractWithFallback(
    content: string,
    file: { path: string; name: string },
    workspaceId: string
  ): IngestedMemory[] {
    const fileHash = this.hashPath(path.resolve(file.path));
    const sections = this.splitIntoSections(content);
    
    // Limit to reasonable number of chunks per file
    const maxChunks = 10;
    const chunks = sections.slice(0, maxChunks);
    
    console.info('[Ghost][Ingest] Fallback extraction creating chunks', {
      file: file.name,
      totalSections: sections.length,
      chunksStored: chunks.length,
    });

    return chunks.map((chunk, index) => ({
      id: `chunk-${fileHash}-${index}`,
      type: 'doc.chunk',
      summary: `${file.name}: ${chunk.slice(0, 500)}`,
      score: 0.8,  // Good confidence for raw content
      metadata: {
        path: file.path,
        name: file.name,
        kind: 'file.fallback',
        source_file_id: `file-${fileHash}`,
        chunk_index: index,
        total_chunks: chunks.length,
      },
      workspace_id: workspaceId,
      createdAt: new Date().toISOString(),
      source: 'file' as const,
    }));
  }

  /**
   * Convert file content into a conversation format for MemoryLayer.
   * Splits content by paragraphs/sections to enable better chunking.
   */
  private convertToConversation(content: string, filePath: string, fileName: string): NormalizedConversation {
    // Split content into logical sections (paragraphs, code blocks, etc.)
    const sections = this.splitIntoSections(content);

    // Convert each section into a "message"
    const messages: NormalizedMessage[] = sections.map((section, index) => ({
      id: `msg-${index}`,
      role: 'user' as const,
      content: section,
      timestamp: new Date().toISOString(),
      metadata: {
        section: index,
        source: 'document',
      },
    }));

    // Create synthetic conversation
    const conversationId = `doc-${this.hashPath(filePath)}`;

    return {
      id: conversationId,
      messages,
      metadata: {
        type: 'document',
        fileName,
        filePath,
        sectionCount: sections.length,
      },
    };
  }

  /**
   * Split content into logical sections for better chunking.
   * Prefers paragraph boundaries, fallback to sentence boundaries.
   */
  private splitIntoSections(content: string): string[] {
    const clean = content.replace(/\s+/g, ' ').trim();
    if (!clean) return [];

    // Split by double newlines (paragraphs) or single newlines
    const paragraphs = clean.split(/\n\n+/).filter(p => p.trim().length > 0);

    // If paragraphs are too long (>2000 chars), split them further by sentences
    const sections: string[] = [];
    for (const para of paragraphs) {
      if (para.length <= 2000) {
        sections.push(para.trim());
      } else {
        // Split long paragraphs by sentences
        const sentences = para.split(/[.!?]+/).filter(s => s.trim().length > 0);
        let currentSection = '';

        for (const sentence of sentences) {
          if ((currentSection + sentence).length > 2000 && currentSection) {
            sections.push(currentSection.trim());
            currentSection = sentence;
          } else {
            currentSection += (currentSection ? '. ' : '') + sentence;
          }
        }

        if (currentSection) {
          sections.push(currentSection.trim());
        }
      }
    }

    return sections;
  }

  /**
   * Extract memories using MemoryLayer with semantic chunking enabled.
   */
  private async extractWithMemoryLayer(
    conversation: NormalizedConversation,
    workspaceId: string,
    file: { path: string; name: string }
  ): Promise<IngestedMemory[]> {
    try {
      // Ensure MemoryLayer is initialized
      if (!memoryLayerIntegration.memoryExtractor) {
        await memoryLayerIntegration.initialize();
      }

      const extractor = memoryLayerIntegration.memoryExtractor;
      if (!extractor) {
        throw new Error('MemoryExtractor not initialized');
      }

      console.info('[Ghost][Ingest] Extracting memories with MemoryLayer', {
        file: file.name,
        messageCount: conversation.messages.length,
        chunkingEnabled: true,
      });

      // Extract with chunking - MemoryLayer will automatically chunk if needed
      const result = await extractor.extract(conversation, workspaceId, {
        memoryTypes: ['fact', 'entity'],  // Focus on facts and entities
        minConfidence: 0.7,  // Higher confidence for documents
        includeRelationships: false,  // Don't need relationships for file content
      });

      if (!result.ok) {
        console.error('[Ghost][Ingest] MemoryLayer extraction failed', {
          error: result.error,
          file: file.path,
        });
        return [];
      }

      const { memories, chunkingMetadata } = result.value;

      // Log chunking stats if chunking was used
      if (chunkingMetadata) {
        console.info('[Ghost][Ingest] Chunking was used for large file', {
          file: file.name,
          chunks: chunkingMetadata.totalChunks,
          memories: memories.length,
          strategy: chunkingMetadata.strategy,
        });
      }

      const fileHash = this.hashPath(path.resolve(file.path));

      // Convert MemoryLayer memories to Ghost storage format
      return memories.map((memory, index) => ({
        id: `doc-${fileHash}-${index}`,
        type: 'fact',
        summary: `${file.name}: ${memory.content}`,
        score: memory.confidence,
        metadata: {
          path: file.path,
          name: file.name,
          kind: 'file.ingest',
          source_file_id: `file-${fileHash}`,
          snippet: memory.content.slice(0, 400),
          memory_type: memory.type,
          source_chunks: memory.source_chunks,
          chunk_confidence: memory.chunk_confidence,
        },
        workspace_id: workspaceId,
        createdAt: new Date().toISOString(),
        source: 'file' as const,
      }));

    } catch (error) {
      console.error('[Ghost][Ingest] MemoryLayer extraction error', {
        error: error instanceof Error ? error.message : error,
        file: file.path,
      });
      return [];
    }
  }

  private isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).replace('.', '').toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  }

  async extractPdf(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
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

  private hashPath(p: string): string {
    return crypto.createHash('md5').update(p).digest('hex');
  }
}

export const fileContentIngestor = new FileContentIngestor();
