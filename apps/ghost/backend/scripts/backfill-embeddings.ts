import Database from 'better-sqlite3';
import { localEmbeddingProvider } from '../src/adapters/local-embedding-provider.ts';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Backfill embeddings for memories where embedding IS NULL.
 * Also repairs broken file memories whose content was set to a numeric score
 * and fixes invalid confidences that were swapped into the content column.
 *
 * Usage: ts-node scripts/backfill-embeddings.ts [path/to/ghost.db]
 */
async function main() {
  const dbPath = process.argv[2] || './ghost.db';
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) {
    console.error(`DB not found at ${resolvedDbPath}`);
    process.exit(1);
  }

  const db = new Database(resolvedDbPath);
  const rows = db
    .prepare('SELECT id, content, type, metadata, confidence, embedding FROM memories')
    .all() as Array<{
      id: string;
      content: string | null;
      type: string;
      metadata: string | null;
      confidence: number | string | null;
      embedding: string | null;
    }>;

  // Determine which rows need embedding (null) or content repair (numeric/empty file summaries)
  const needsWork = rows
    .map((row) => {
      const repairContent = shouldRepairFileContent(row);
      const repairConfidence = shouldRepairConfidence(row);
      const noEmbedding = row.embedding === null;
      const content = ensureContent(row);
      const confidence = repairConfidence ? repairedConfidence(row) : normalizedConfidence(row);
      const needsEmbedding = noEmbedding || repairContent; // re-embed if content changed or missing embedding
      return { row, repairContent, repairConfidence, needsEmbedding, content, confidence };
    })
    .filter((item) => item.repairContent || item.repairConfidence || item.needsEmbedding);

  console.info(`Found ${needsWork.length} memories needing embeddings and/or content/confidence repair`);

  const update = db.prepare(
    "UPDATE memories SET content = ?, confidence = ?, embedding = ?, updated_at = datetime('now') WHERE id = ?"
  );

  for (const item of needsWork) {
    const content = item.content;
    const confidence = item.confidence;
    const embedding =
      item.needsEmbedding || item.repairContent
        ? await localEmbeddingProvider.embed(content)
        : item.row.embedding;
    update.run(content, confidence, JSON.stringify(embedding), item.row.id);
  }
  console.info('Backfill complete');
}

function shouldRepairFileContent(row: { content: string | null; type: string }): boolean {
  if (!row.type?.startsWith('entity.file')) return false;
  if (!row.content) return true;
  const trimmed = row.content.trim();
  return /^[0-9.]+$/.test(trimmed); // numeric scores like "0.82"
}

function shouldRepairConfidence(row: { confidence: number | string | null; type: string }): boolean {
  if (!row.type?.startsWith('entity.file')) return false;
  if (row.confidence === null || row.confidence === undefined) return true;
  if (typeof row.confidence === 'number') {
    return row.confidence < 0 || row.confidence > 1;
  }
  const numeric = Number(row.confidence);
  if (Number.isFinite(numeric)) {
    return numeric < 0 || numeric > 1;
  }
  return true;
}

function normalizedConfidence(row: { confidence: number | string | null }): number {
  if (typeof row.confidence === 'number') return row.confidence;
  const numeric = Number(row.confidence);
  return Number.isFinite(numeric) ? numeric : 0.82;
}

function repairedConfidence(row: { type: string }): number {
  // Default score we used for action-created file memories
  if (row.type?.startsWith('entity.file')) return 0.82;
  return 0.75;
}

function ensureContent(row: {
  content: string | null;
  type: string;
  metadata: string | null;
}): string {
  if (!row.type?.startsWith('entity.file')) {
    return row.content ?? '';
  }

  const meta = row.metadata ? safeParseJson(row.metadata) : {};
  const pathVal = meta?.path as string | undefined;
  const nameVal =
    (meta?.name as string | undefined) ||
    (pathVal ? pathVal.split(/[\\/]/).pop() || 'Unknown file' : 'Unknown file');
  const modifiedVal = (meta?.modified as string | undefined) || 'unknown time';

  const defaultSummary = `${nameVal} (modified ${modifiedVal}) @ ${pathVal || 'unknown path'}`;

  // If existing content looks valid (non-numeric, non-empty), keep it; otherwise rebuild
  if (row.content && !/^[0-9.]+$/.test(row.content.trim())) {
    return row.content;
  }
  return defaultSummary;
}

function safeParseJson(input: string): Record<string, any> | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
