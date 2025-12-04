# Database Migrations

This directory contains SQL migration files and the migration runner for the MemoryLayer storage layer.

## Migration Files

Migration files follow the naming convention: `NNN_description.sql`

- `NNN` is a zero-padded sequential number (e.g., 001, 002, 003)
- `description` is a brief description using underscores (e.g., `initial_schema`, `add_user_preferences`)

### Migration File Structure

Each migration file should contain two sections:

1. **UP MIGRATION**: SQL statements to apply the migration
2. **DOWN MIGRATION**: SQL statements to rollback the migration

Example:

```sql
-- UP MIGRATION

CREATE TABLE example (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

-- DOWN MIGRATION

DROP TABLE IF EXISTS example CASCADE;
```

## Using the Migration CLI

### Prerequisites

Set the required environment variables:

```bash
export DATABASE_URL="https://your-project.supabase.co"
export DATABASE_KEY="your-supabase-api-key"
```

### Commands

#### Apply all pending migrations

```bash
npm run migrate up
```

This will:
- Create the `schema_migrations` tracking table if it doesn't exist
- Apply all migrations that haven't been applied yet
- Record each applied migration in the tracking table

#### Rollback the last migration

```bash
npm run migrate down
```

#### Rollback multiple migrations

```bash
npm run migrate down 3
```

This will rollback the last 3 migrations in reverse order.

#### Check migration status

```bash
npm run migrate status
```

This shows which migrations have been applied and which are pending.

## Using the Migration Runner Programmatically

You can also use the `MigrationRunner` class directly in your code:

```typescript
import { MigrationRunner } from '@memorylayer/storage';

const runner = new MigrationRunner({
  url: process.env.DATABASE_URL!,
  apiKey: process.env.DATABASE_KEY!,
});

// Apply all pending migrations
await runner.up();

// Rollback the last migration
await runner.down(1);

// Check migration status
await runner.status();
```

## Creating New Migrations

1. Create a new SQL file in this directory with the next sequential number:
   ```
   002_add_user_preferences.sql
   ```

2. Add your UP MIGRATION SQL:
   ```sql
   -- UP MIGRATION
   
   ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
   ```

3. Add your DOWN MIGRATION SQL:
   ```sql
   -- DOWN MIGRATION
   
   ALTER TABLE users DROP COLUMN IF EXISTS preferences;
   ```

4. Run the migration:
   ```bash
   npm run migrate up
   ```

## Migration Tracking

The migration runner creates a `schema_migrations` table to track which migrations have been applied:

```sql
CREATE TABLE schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

This table is automatically created when you run your first migration.

## Best Practices

1. **Never modify applied migrations**: Once a migration has been applied to production, create a new migration instead of modifying the existing one.

2. **Always include DOWN migrations**: This allows you to rollback changes if needed.

3. **Test migrations**: Test both UP and DOWN migrations in a development environment before applying to production.

4. **Keep migrations small**: Each migration should focus on a single logical change.

5. **Use transactions**: The migration runner executes each migration as a single operation, but complex migrations should use explicit transactions if needed.

6. **Backup before rollback**: Always backup your database before rolling back migrations in production.
