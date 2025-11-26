/**
 * MigrationRunner - Manages database schema migrations
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Configuration for migration runner
 */
export interface MigrationConfig {
  url: string;
  apiKey: string;
  migrationsPath?: string;
}

/**
 * Represents a migration file
 */
export interface Migration {
  id: number;
  name: string;
  filename: string;
  sql: string;
}

/**
 * Represents an applied migration record
 */
export interface AppliedMigration {
  id: number;
  name: string;
  applied_at: Date;
}

/**
 * MigrationRunner handles database schema migrations
 */
export class MigrationRunner {
  private client: SupabaseClient;
  private migrationsPath: string;

  constructor(config: MigrationConfig) {
    this.client = createClient(config.url, config.apiKey, {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
      },
    });

    // Default migrations path is the migrations directory
    if (config.migrationsPath) {
      this.migrationsPath = config.migrationsPath;
    } else {
      // Get the directory of the current module
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      this.migrationsPath = __dirname;
    }
  }

  /**
   * Initialize the migrations tracking table
   */
  private async initMigrationsTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    const { error } = await this.client.rpc('exec_sql', {
      query: createTableSQL,
      params: [],
    });

    if (error) {
      throw new Error(`Failed to create migrations table: ${error.message}`);
    }
  }

  /**
   * Get list of applied migrations from the database
   */
  private async getAppliedMigrations(): Promise<AppliedMigration[]> {
    const { data, error } = await this.client
      .from('schema_migrations')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Failed to query applied migrations: ${error.message}`);
    }

    return (data || []) as AppliedMigration[];
  }

  /**
   * Read and parse migration files from the migrations directory
   */
  private async readMigrationFiles(): Promise<Migration[]> {
    try {
      const files = await readdir(this.migrationsPath);
      
      // Filter for SQL files and sort them
      const sqlFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort();

      const migrations: Migration[] = [];

      for (const filename of sqlFiles) {
        // Extract migration ID from filename (e.g., "001_initial_schema.sql" -> 1)
        const match = filename.match(/^(\d+)_(.+)\.sql$/);
        if (!match) {
          console.warn(`Skipping invalid migration filename: ${filename}`);
          continue;
        }

        const id = parseInt(match[1], 10);
        const name = match[2].replace(/_/g, ' ');

        // Read the SQL content
        const filepath = join(this.migrationsPath, filename);
        const sql = await readFile(filepath, 'utf-8');

        migrations.push({
          id,
          name,
          filename,
          sql,
        });
      }

      return migrations;
    } catch (error) {
      throw new Error(`Failed to read migration files: ${(error as Error).message}`);
    }
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(migration: Migration): Promise<void> {
    console.log(`Applying migration ${migration.id}: ${migration.name}`);

    // Execute the migration SQL
    const { error: execError } = await this.client.rpc('exec_sql', {
      query: migration.sql,
      params: [],
    });

    if (execError) {
      throw new Error(`Failed to execute migration ${migration.id}: ${execError.message}`);
    }

    // Record the migration as applied
    const { error: insertError } = await this.client
      .from('schema_migrations')
      .insert({
        id: migration.id,
        name: migration.name,
      });

    if (insertError) {
      throw new Error(`Failed to record migration ${migration.id}: ${insertError.message}`);
    }

    console.log(`✓ Migration ${migration.id} applied successfully`);
  }

  /**
   * Rollback a single migration
   */
  private async rollbackMigration(migration: Migration): Promise<void> {
    console.log(`Rolling back migration ${migration.id}: ${migration.name}`);

    // Parse the SQL to extract DROP statements or create reverse operations
    // For simplicity, we'll look for a comment block with down migration
    const downMatch = migration.sql.match(/-- DOWN MIGRATION\s+([\s\S]*?)(?:-- UP MIGRATION|$)/i);
    
    if (!downMatch) {
      throw new Error(
        `Migration ${migration.id} does not have a DOWN MIGRATION section. ` +
        `Add a comment block with "-- DOWN MIGRATION" followed by rollback SQL.`
      );
    }

    const downSQL = downMatch[1].trim();

    if (!downSQL) {
      throw new Error(`Migration ${migration.id} has an empty DOWN MIGRATION section`);
    }

    // Execute the down migration SQL
    const { error: execError } = await this.client.rpc('exec_sql', {
      query: downSQL,
      params: [],
    });

    if (execError) {
      throw new Error(`Failed to rollback migration ${migration.id}: ${execError.message}`);
    }

    // Remove the migration record
    const { error: deleteError } = await this.client
      .from('schema_migrations')
      .delete()
      .eq('id', migration.id);

    if (deleteError) {
      throw new Error(`Failed to remove migration record ${migration.id}: ${deleteError.message}`);
    }

    console.log(`✓ Migration ${migration.id} rolled back successfully`);
  }

  /**
   * Run all pending migrations (up migration)
   */
  async up(): Promise<void> {
    console.log('Running migrations...\n');

    try {
      // Initialize migrations table
      await this.initMigrationsTable();

      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const appliedIds = new Set(appliedMigrations.map(m => m.id));

      // Read migration files
      const migrations = await this.readMigrationFiles();

      if (migrations.length === 0) {
        console.log('No migration files found');
        return;
      }

      // Filter pending migrations
      const pendingMigrations = migrations.filter(m => !appliedIds.has(m.id));

      if (pendingMigrations.length === 0) {
        console.log('No pending migrations');
        return;
      }

      console.log(`Found ${pendingMigrations.length} pending migration(s)\n`);

      // Execute pending migrations in order
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
      }

      console.log('\n✓ All migrations completed successfully');
    } catch (error) {
      console.error('\n✗ Migration failed:', (error as Error).message);
      throw error;
    }
  }

  /**
   * Rollback the last N migrations (down migration)
   */
  async down(count: number = 1): Promise<void> {
    console.log(`Rolling back ${count} migration(s)...\n`);

    try {
      // Initialize migrations table
      await this.initMigrationsTable();

      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();

      if (appliedMigrations.length === 0) {
        console.log('No migrations to rollback');
        return;
      }

      // Read migration files
      const migrations = await this.readMigrationFiles();
      const migrationMap = new Map(migrations.map(m => [m.id, m]));

      // Get the last N applied migrations in reverse order
      const migrationsToRollback = appliedMigrations
        .slice(-count)
        .reverse();

      console.log(`Rolling back ${migrationsToRollback.length} migration(s)\n`);

      // Rollback migrations in reverse order
      for (const applied of migrationsToRollback) {
        const migration = migrationMap.get(applied.id);
        
        if (!migration) {
          throw new Error(
            `Migration file for ${applied.id} (${applied.name}) not found. ` +
            `Cannot rollback without the migration file.`
          );
        }

        await this.rollbackMigration(migration);
      }

      console.log('\n✓ All rollbacks completed successfully');
    } catch (error) {
      console.error('\n✗ Rollback failed:', (error as Error).message);
      throw error;
    }
  }

  /**
   * Show migration status
   */
  async status(): Promise<void> {
    console.log('Migration status:\n');

    try {
      // Initialize migrations table
      await this.initMigrationsTable();

      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const appliedIds = new Set(appliedMigrations.map(m => m.id));

      // Read migration files
      const migrations = await this.readMigrationFiles();

      if (migrations.length === 0) {
        console.log('No migration files found');
        return;
      }

      console.log('ID  | Status  | Name');
      console.log('----+---------+' + '-'.repeat(50));

      for (const migration of migrations) {
        const status = appliedIds.has(migration.id) ? '✓ Applied' : '  Pending';
        console.log(`${migration.id.toString().padStart(3)} | ${status} | ${migration.name}`);
      }

      const pendingCount = migrations.filter(m => !appliedIds.has(m.id)).length;
      console.log(`\nTotal: ${migrations.length} migrations (${appliedMigrations.length} applied, ${pendingCount} pending)`);
    } catch (error) {
      console.error('\n✗ Failed to get migration status:', (error as Error).message);
      throw error;
    }
  }
}
