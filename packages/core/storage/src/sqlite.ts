import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { StorageError, Result } from './errors.js';
import { StorageAdapter, Transaction } from './adapter.js';

/**
 * Configuration for SQLite connection
 */
export interface SqliteConfig {
    filename: string;
    migrationsDir?: string;
}

/**
 * SqliteAdapter provides type-safe database operations using SQLite
 */
export class SqliteAdapter implements StorageAdapter {
    private db: Database.Database;

    constructor(config: SqliteConfig) {
        // Ensure directory exists
        const dir = path.dirname(config.filename);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(config.filename);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        if (config.migrationsDir) {
            this.runMigrations(config.migrationsDir);
        }
    }

    private runMigrations(migrationsDir: string) {
        // Create migrations table if not exists
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const row = this.db.prepare('SELECT * FROM migrations WHERE name = ?').get(file);
            if (!row) {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                this.db.transaction(() => {
                    this.db.exec(sql);
                    this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
                })();
            }
        }
    }

    /**
     * Execute a raw SQL query with parameter binding
     */
    async query<T>(sql: string, params: any[] = []): Promise<Result<T[], StorageError>> {
        try {
            // Convert Postgres-style $1, $2 to SQLite ?
            // This is a simple regex, might need more robustness for complex queries
            // but for our usage it should be fine if we stick to simple queries.
            // Ideally we should use named parameters or standard ? in our code.
            // But since we are mirroring Postgres adapter which likely uses $1, we might need to convert.
            // However, better-sqlite3 supports named parameters (@param) or anonymous (?).
            // If the input sql uses $1, we need to convert it to ? and ensure params order matches.

            // For now, let's assume the caller handles the SQL dialect or we do a simple replace.
            // A robust solution would be to use a query builder like Kysely or Knex, but we are building a raw adapter.
            // Let's try to support $n by replacing with ?

            const convertedSql = sql.replace(/\$\d+/g, '?');

            const stmt = this.db.prepare(convertedSql);
            let result: any[];

            if (convertedSql.trim().toLowerCase().startsWith('select')) {
                result = stmt.all(...params);
            } else {
                const info = stmt.run(...params);
                // For non-select, we might want to return something else, but the interface says T[]
                // Usually for INSERT/UPDATE/DELETE we use specific methods.
                // If query is used for them, we return empty array or RETURNING if supported.
                result = [];
            }

            return { ok: true, value: result as T[] };
        } catch (error: any) {
            return {
                ok: false,
                error: {
                    type: 'database',
                    message: 'Query execution failed',
                    cause: error,
                },
            };
        }
    }

    /**
     * Insert a record into a table
     */
    async insert<T>(table: string, data: object): Promise<Result<T, StorageError>> {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const placeholders = keys.map(() => '?').join(', ');
            const columns = keys.join(', ');

            const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
            const stmt = this.db.prepare(sql);
            const result = stmt.get(...values);

            return { ok: true, value: result as T };
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return {
                    ok: false,
                    error: {
                        type: 'conflict',
                        message: `Record already exists in ${table}`,
                    },
                };
            }
            return {
                ok: false,
                error: {
                    type: 'database',
                    message: `Failed to insert into ${table}`,
                    cause: error,
                },
            };
        }
    }

    /**
     * Update a record in a table
     */
    async update<T>(table: string, id: string, data: object): Promise<Result<T, StorageError>> {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const setClause = keys.map(k => `${k} = ?`).join(', ');

            const sql = `UPDATE ${table} SET ${setClause} WHERE id = ? RETURNING *`;
            const stmt = this.db.prepare(sql);
            const result = stmt.get(...values, id);

            if (!result) {
                return {
                    ok: false,
                    error: {
                        type: 'not_found',
                        resource: table,
                        id: id,
                    },
                };
            }

            return { ok: true, value: result as T };
        } catch (error: any) {
            return {
                ok: false,
                error: {
                    type: 'database',
                    message: `Failed to update ${table}`,
                    cause: error,
                },
            };
        }
    }

    /**
     * Delete a record from a table
     */
    async delete(table: string, id: string): Promise<Result<void, StorageError>> {
        try {
            const sql = `DELETE FROM ${table} WHERE id = ?`;
            const stmt = this.db.prepare(sql);
            const info = stmt.run(id);

            // SQLite doesn't error if not found, but we can check changes
            // However, the interface doesn't strictly require error on not found for delete,
            // but it's good practice.
            // Postgres adapter returns error if error occurs, but if no rows deleted?
            // Postgres adapter uses `eq('id', id)` which might not error if not found, just delete 0 rows.
            // Let's match that behavior (success even if nothing deleted).

            return { ok: true, value: undefined };
        } catch (error: any) {
            return {
                ok: false,
                error: {
                    type: 'database',
                    message: `Failed to delete from ${table}`,
                    cause: error,
                },
            };
        }
    }

    /**
     * Begin a transaction
     */
    async beginTransaction(): Promise<Result<Transaction, StorageError>> {
        try {
            // better-sqlite3 transactions are synchronous functions.
            // But our interface is async.
            // We can't easily expose "commit" and "rollback" as separate async methods 
            // that control a single transaction scope in better-sqlite3 because 
            // better-sqlite3 transactions are closures.

            // However, we can use SAVEPOINT for nested transactions or just raw BEGIN/COMMIT/ROLLBACK
            // since we are in a single connection (better-sqlite3 is synchronous and usually single connection per instance).
            // BUT, better-sqlite3 `transaction` function is the preferred way.

            // If we want to support the `Transaction` interface which allows manual commit/rollback:
            // We can use `db.exec('BEGIN')` etc.

            this.db.exec('BEGIN');

            const transaction: Transaction = {
                query: async <T>(sql: string, params: any[] = []): Promise<T[]> => {
                    const convertedSql = sql.replace(/\$\d+/g, '?');
                    const stmt = this.db.prepare(convertedSql);
                    if (convertedSql.trim().toLowerCase().startsWith('select')) {
                        return stmt.all(...params) as T[];
                    } else {
                        stmt.run(...params);
                        return [] as T[];
                    }
                },
                insert: async <T>(table: string, data: object): Promise<T> => {
                    const keys = Object.keys(data);
                    const values = Object.values(data);
                    const placeholders = keys.map(() => '?').join(', ');
                    const columns = keys.join(', ');
                    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
                    const stmt = this.db.prepare(sql);
                    return stmt.get(...values) as T;
                },
                update: async <T>(table: string, id: string, data: object): Promise<T> => {
                    const keys = Object.keys(data);
                    const values = Object.values(data);
                    const setClause = keys.map(k => `${k} = ?`).join(', ');
                    const sql = `UPDATE ${table} SET ${setClause} WHERE id = ? RETURNING *`;
                    const stmt = this.db.prepare(sql);
                    return stmt.get(...values, id) as T;
                },
                delete: async (table: string, id: string): Promise<void> => {
                    const sql = `DELETE FROM ${table} WHERE id = ?`;
                    this.db.prepare(sql).run(id);
                },
                commit: async (): Promise<void> => {
                    this.db.exec('COMMIT');
                },
                rollback: async (): Promise<void> => {
                    this.db.exec('ROLLBACK');
                }
            };

            return { ok: true, value: transaction };
        } catch (error: any) {
            return {
                ok: false,
                error: {
                    type: 'database',
                    message: 'Failed to begin transaction',
                    cause: error,
                },
            };
        }
    }
}
