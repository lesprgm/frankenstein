import fs from 'fs'
import path from 'path'
import { DatabaseClient } from '../lib/db'

async function runMigration() {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_KEY')
        process.exit(1)
    }

    const db = new DatabaseClient(supabaseUrl, supabaseKey, { mockMode: false })

    const migrationPath = path.join(process.cwd(), 'migrations', '005_semantic_search.sql')
    console.log(`Reading migration from: ${migrationPath}`)

    try {
        const sql = fs.readFileSync(migrationPath, 'utf8')
        console.log('Executing migration SQL...')

        // Split by semicolon to run statements individually
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)

        for (const statement of statements) {
            try {
                console.log(`Running: ${statement.substring(0, 50)}...`)
                await db.query(statement)
                console.log('  ✅ Success')
            } catch (error: any) {
                // Ignore "permission denied to create extension" if it's that specific error
                if (error.message.includes('permission denied to create extension')) {
                    console.warn('  ⚠️  Skipping CREATE EXTENSION (permission denied). Assuming extension exists or requires dashboard enablement.')
                } else if (error.message.includes('already exists')) {
                    console.log('  ℹ️  Already exists, skipping.')
                } else {
                    console.error('  ❌ Failed:', error.message)
                    // If it fails on vector type, we should probably stop
                    if (error.message.includes('type "vector" does not exist')) {
                        throw new Error('Vector extension is not enabled. Please enable "vector" extension in Supabase Dashboard.')
                    }
                    throw error
                }
            }
        }

        console.log('✅ Migration process finished!')
    } catch (error) {
        console.error('❌ Migration failed:', error)
        process.exit(1)
    }
}

runMigration()
