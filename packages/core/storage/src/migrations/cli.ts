#!/usr/bin/env node

/**
 * CLI tool for running database migrations
 */

import { MigrationRunner } from './migration-runner.js';

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string; count?: number } {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return { command: 'help' };
  }

  const command = args[0];
  
  if (command === 'down' && args.length > 1) {
    const count = parseInt(args[1], 10);
    if (isNaN(count) || count < 1) {
      console.error('Error: Invalid count for down migration');
      process.exit(1);
    }
    return { command, count };
  }

  return { command };
}

/**
 * Show usage information
 */
function showHelp(): void {
  console.log(`
Usage: migrate <command> [options]

Commands:
  up              Apply all pending migrations
  down [count]    Rollback the last migration (or last N migrations)
  status          Show migration status
  help            Show this help message

Environment Variables:
  DATABASE_URL    Supabase database URL (required)
  DATABASE_KEY    Supabase API key (required)

Examples:
  migrate up                    # Apply all pending migrations
  migrate down                  # Rollback the last migration
  migrate down 3                # Rollback the last 3 migrations
  migrate status                # Show migration status
`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const { command, count } = parseArgs();

  // Show help
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  // Validate environment variables
  const databaseUrl = process.env.DATABASE_URL;
  const databaseKey = process.env.DATABASE_KEY;

  if (!databaseUrl || !databaseKey) {
    console.error('Error: DATABASE_URL and DATABASE_KEY environment variables are required');
    console.error('');
    console.error('Example:');
    console.error('  export DATABASE_URL="https://your-project.supabase.co"');
    console.error('  export DATABASE_KEY="your-api-key"');
    console.error('  migrate up');
    process.exit(1);
  }

  // Create migration runner
  const runner = new MigrationRunner({
    url: databaseUrl,
    apiKey: databaseKey,
  });

  try {
    // Execute command
    switch (command) {
      case 'up':
        await runner.up();
        break;

      case 'down':
        await runner.down(count || 1);
        break;

      case 'status':
        await runner.status();
        break;

      default:
        console.error(`Error: Unknown command "${command}"`);
        console.error('Run "migrate help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error('\nMigration failed:', (error as Error).message);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
