/**
 * Example: Running migrations programmatically
 * 
 * This example demonstrates how to use the MigrationRunner class
 * to manage database migrations in your application code.
 */

import { MigrationRunner } from '../src/index.js';

async function main() {
  // Check for required environment variables
  const databaseUrl = process.env.DATABASE_URL;
  const databaseKey = process.env.DATABASE_KEY;

  if (!databaseUrl || !databaseKey) {
    console.error('Error: DATABASE_URL and DATABASE_KEY environment variables are required');
    console.error('');
    console.error('Example:');
    console.error('  export DATABASE_URL="https://your-project.supabase.co"');
    console.error('  export DATABASE_KEY="your-api-key"');
    process.exit(1);
  }

  // Create a migration runner instance
  const runner = new MigrationRunner({
    url: databaseUrl,
    apiKey: databaseKey,
  });

  try {
    console.log('=== Migration Status ===\n');
    await runner.status();

    console.log('\n=== Applying Migrations ===\n');
    await runner.up();

    console.log('\n=== Final Status ===\n');
    await runner.status();

    console.log('\n✓ Migration example completed successfully');
  } catch (error) {
    console.error('\n✗ Migration example failed:', (error as Error).message);
    process.exit(1);
  }
}

main();
