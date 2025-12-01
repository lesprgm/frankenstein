import { beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Buffer } from 'node:buffer'
import { newDb, DataType } from 'pg-mem'

// Load environment variables from .dev.vars
function loadDevVars() {
  try {
    const devVarsPath = join(process.cwd(), '.dev.vars')
    const content = readFileSync(devVarsPath, 'utf-8')
    
    content.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=')
          process.env[key] = value
        }
      }
    })
  } catch (error) {
    console.warn('Could not load .dev.vars file:', error)
  }
}

let originalFetch: typeof fetch
type PgMemPool = InstanceType<
  ReturnType<ReturnType<typeof newDb>['adapters']['createPg']>['Pool']
>
let mockPool: PgMemPool | null = null
const workspaceCache = new Map<string, any>()

async function setupMockDatabase() {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID()
  })

  // generate_series(start, stop) helper for db.test
  db.public.registerFunction({
    name: 'generate_series',
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: (start: number, stop: number) => {
      const values: number[] = []
      for (let i = start; i <= stop; i++) values.push(i)
      return values
    }
  })

  const appRoot = process.cwd()
  const migrationDir = join(appRoot, 'src', 'migrations')
  const migrationFiles = [
    '001_auth_tables.sql',
    '002_conversations_tables.sql',
    '003_add_user_attribution.sql',
    '004_activities_table.sql'
  ]
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationDir, file), 'utf-8')
    db.public.none(sql)
  }

  db.public.none(`
    CREATE TABLE IF NOT EXISTS memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      embedding_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL
    );
    
    CREATE TABLE IF NOT EXISTS relationships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      from_memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
      to_memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
      source_memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
      target_memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_conversation ON memories(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_workspace ON relationships(workspace_id);
  `)

  db.public.none(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  const pg = db.adapters.createPg()
  const { Pool } = pg
  mockPool = new Pool()

  originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url

    if (url.includes('/rest/v1/rpc/exec_sql')) {
      try {
        const bodyText = typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof Buffer
            ? init.body.toString('utf-8')
            : ''
        const payload = bodyText ? JSON.parse(bodyText) : { query: '', params: [] }
        const { query, params = [] } = payload

        const genRe = /generate_series\s*\(/i
        if (genRe.test(query)) {
          const match = query.match(/generate_series\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i)
          const start = match ? parseInt(match[1], 10) : 1
          const stop = match ? parseInt(match[2], 10) : start
          const rows = []
          for (let i = start; i <= stop; i++) rows.push({ num: i })
          return new Response(JSON.stringify(rows), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Workspace insert handling (avoid pg-mem backslash JSON parse issues)
        if (/insert\s+into\s+workspaces/i.test(query)) {
          const [id, name, type, ownerId, createdAt] = params
          const created = createdAt ?? new Date().toISOString()
          workspaceCache.set(id, {
            id,
            name,
            type,
            owner_id: ownerId,
            created_at: created,
            updated_at: created
          })

          const safeName = typeof name === 'string' ? name.replace(/\\/g, '\\\\') : name
          const safeQuery = createdAt
            ? 'INSERT INTO workspaces (id, name, type, owner_id, created_at) VALUES ($1, $2, $3, $4, $5)'
            : 'INSERT INTO workspaces (id, name, type, owner_id) VALUES ($1, $2, $3, $4)'
          const safeParams = createdAt
            ? [id, safeName, type, ownerId, createdAt]
            : [id, safeName, type, ownerId]

          try {
            await mockPool!.query(safeQuery, safeParams)
          } catch {
            // pg-mem struggles with backslashes in parameters; rely on cache for those rows
          }

          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Workspace selects by id served from cache (preserve original strings)
        if (/select\s+.+from\s+workspaces\s+where\s+id\s*=\s*\$1/i.test(query)) {
          const cached = workspaceCache.get(params[0])
          if (cached) {
            return new Response(JSON.stringify([cached]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        }

        // Workspace deletes should clear cache too
        if (/delete\s+from\s+workspaces\s+where\s+id\s*=\s*\$1/i.test(query)) {
          workspaceCache.delete(params[0])
          try {
            const result = await mockPool!.query(query, params)
            return new Response(JSON.stringify(result.rows ?? []), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          } catch {
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        }

        // Handle multi-value message inserts (pg-mem reuses default IDs per statement)
        if (/^\s*insert\s+into\s+messages/i.test(query) && /\),/i.test(query)) {
          const convId = params[0]
          const matches = [...query.matchAll(/\(\s*\$1\s*,\s*'([^']+)'\s*,\s*'([^']+)'/gi)]
          for (const m of matches) {
            const role = m[1]
            const content = m[2]
            await mockPool!.query(
              `INSERT INTO messages (id, conversation_id, role, content, created_at, raw_metadata) VALUES ($1, $2, $3, $4, NOW(), $5)`,
              [crypto.randomUUID(), convId, role, content, {}]
            )
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Rewrite ANY($1) with expanded IN list for pg-mem
        if (/ANY\(\$1\)/i.test(query) && Array.isArray(params[0])) {
          const arr = params[0] as any[]
          const placeholders = arr.map((_, i) => `$${i + 1}`).join(', ')
          const rewritten = query.replace(/=?\s*ANY\(\$1\)/i, `IN (${placeholders})`)
          const result = await mockPool!.query(rewritten, arr)
          return new Response(JSON.stringify(result.rows ?? []), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        let result
        try {
          result = await mockPool!.query(query, params)
        } catch (err: any) {
          const msg = err?.message || ''
          if (/insert\s+into\s+workspaces/i.test(query) && /Bad escaped character in JSON/i.test(msg)) {
            const fixedParams = [...params]
            if (typeof fixedParams[1] === 'string') {
              fixedParams[1] = (fixedParams[1] as string).replace(/\\/g, '\\\\')
            }
            result = await mockPool!.query(query, fixedParams)
          } else {
            throw err
          }
        }
        return new Response(JSON.stringify(result.rows ?? []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return new Response(message, { status: 400 })
      }
    }

    return originalFetch(input as any, init as any)
  }
}

// Test environment setup
beforeAll(async () => {
  // Load environment variables from .dev.vars
  loadDevVars()
  
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = 'mock://supabase.local'
  }
  if (!process.env.SUPABASE_KEY) {
    process.env.SUPABASE_KEY = 'mock-key'
  }
  process.env.USE_MOCK_SUPABASE = 'true'

  await setupMockDatabase()
})

afterAll(async () => {
  if (mockPool) {
    await mockPool.end()
    mockPool = null
  }
  if (originalFetch) {
    globalThis.fetch = originalFetch
  }
})

// Clean database between tests to avoid cross-test contamination
beforeEach(async () => {
  if (!mockPool) return
  workspaceCache.clear()
  const client = await mockPool.connect()
  try {
    // Manual cleanup in FK-safe order (pg-mem does not support multi-table truncate)
    await client.query('DELETE FROM workspace_members')
    await client.query('DELETE FROM activities')
    await client.query('DELETE FROM relationships')
    await client.query('DELETE FROM memories')
    await client.query('DELETE FROM messages')
    await client.query('DELETE FROM conversations')
    await client.query('DELETE FROM api_keys')
    await client.query('DELETE FROM workspaces')
    await client.query('DELETE FROM users')
  } catch (err) {
    throw err
  } finally {
    client.release()
  }
})
