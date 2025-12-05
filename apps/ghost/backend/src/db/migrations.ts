import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Initialize and migrate the SQLite database
 */
export function initializeDatabase(dbPath: string): Database.Database {
    const db = new Database(dbPath);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Run migrations
    runMigrations(db);

    return db;
}

/**
 * Run database migrations
 */
function runMigrations(db: Database.Database): void {
    // Create migrations table if it doesn't exist
    db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    const migrations = [
        {
            name: '001_initial_schema',
            run: () => {
                const schemaPath = join(__dirname, 'schema.sql');
                const schema = readFileSync(schemaPath, 'utf-8');
                db.exec(schema);
            },
        },
        {
            name: '002_memorylayer_integration',
            run: () => {
                // This migration is handled by the schema.sql file
                // which now includes MemoryLayer tables
                console.log('MemoryLayer tables created via schema.sql');
            },
        },
        {
            name: '003_explainability_tables',
            run: () => {
                db.exec(`
                    CREATE TABLE IF NOT EXISTS explanation_contexts (
                        command_id TEXT PRIMARY KEY,
                        command_text TEXT NOT NULL,
                        user_query TEXT NOT NULL,
                        reasoning_data TEXT NOT NULL, -- JSON
                        graph_data TEXT NOT NULL, -- JSON
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_explanation_contexts_created_at ON explanation_contexts(created_at DESC);
                `);
                console.log('Explainability tables created');
            },
        },
    ];

    // Apply pending migrations
    for (const migration of migrations) {
        const existing = db.prepare('SELECT name FROM migrations WHERE name = ?').get(migration.name);

        if (!existing) {
            console.log(`Running migration: ${migration.name}`);
            migration.run();
            db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(migration.name);
        }
    }
}

/**
 * Seed demo data for testing
 */
export function seedDemoData(db: Database.Database): void {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Create default user first (required for foreign key)
    db.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, created_at, updated_at)
        VALUES ('ghost-user', 'ghost@local', 'Ghost User', datetime('now'), datetime('now'))
    `).run();

    // Create default workspace
    db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, name, type, owner_id, created_at, updated_at)
        VALUES ('demo', 'Demo Workspace', 'personal', 'ghost-user', datetime('now'), datetime('now'))
    `).run();

    const demoMemories = [
        {
            id: 'mem-demo-file-1',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'entity.file',
            content: 'Q4_Sales_Report.pdf, last modified yesterday 3pm',
            confidence: 0.9,
            metadata: JSON.stringify({ path: '/Users/demo/Documents/Q4_Sales_Report.pdf' }),
            embedding: null,
            created_at: yesterday.toISOString(),
            updated_at: yesterday.toISOString(),
        },
        {
            id: 'mem-demo-person-1',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'entity.person',
            content: 'Sarah - sarah@company.com',
            confidence: 0.88,
            metadata: JSON.stringify({ email: 'sarah@company.com' }),
            embedding: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
        },
        {
            id: 'mem-demo-file-2',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'entity.file',
            content: 'ACME_Q4_Launch_Notes.md, last modified two days ago',
            confidence: 0.85,
            metadata: JSON.stringify({ path: '/Users/demo/Documents/ACME_Q4_Launch_Notes.md' }),
            embedding: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
        },
        {
            id: 'mem-demo-file-3',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'entity.file',
            content: 'Sarah_Meeting_Presentation.pptx, modified today',
            confidence: 0.83,
            metadata: JSON.stringify({ path: '/Users/demo/Documents/Sarah_Meeting_Presentation.pptx' }),
            embedding: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
        },
        {
            id: 'mem-demo-chunk-1',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'doc.chunk',
            content: 'The Maker architecture uses a voting mechanism to ensure consensus among agents. This reduces hallucination rates by 40% compared to single-shot retrieval.',
            confidence: 0.95,
            metadata: JSON.stringify({
                path: '/Users/demo/Documents/Maker_Architecture_Whitepaper.md',
                chunkIndex: 4,
                startLine: 120,
                endLine: 125
            }),
            embedding: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
        },
        {
            id: 'mem-demo-fact-1',
            workspace_id: 'demo',
            conversation_id: null,
            type: 'fact',
            content: 'The user prefers dark mode for all dashboard interfaces.',
            confidence: 0.92,
            metadata: JSON.stringify({ source: 'user_preference' }),
            embedding: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
        },
    ];

    const insertMemory = db.prepare(`
        INSERT OR IGNORE INTO memories (
            id, workspace_id, conversation_id, type, content, 
            confidence, metadata, embedding, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const mem of demoMemories) {
        insertMemory.run(
            mem.id,
            mem.workspace_id,
            mem.conversation_id,
            mem.type,
            mem.content,
            mem.confidence,
            mem.metadata,
            mem.embedding,
            mem.created_at,
            mem.updated_at
        );
    }
}
