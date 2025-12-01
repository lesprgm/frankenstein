#!/usr/bin/env tsx

import { DatabaseClient } from '../src/lib/db.js'
import { MemoryService } from '../src/services/memory.js'

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    const workspaceId = process.env.WORKSPACE_ID || '<ws_id>'

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing SUPABASE_URL or SUPABASE_KEY')
        process.exit(1)
    }

    const db = new DatabaseClient(supabaseUrl, supabaseKey, { mockMode: false })
    const svc = new MemoryService(db)
    const res = await svc.getMemories({ workspaceId, search: 'toolsmith', limit: 5 })
    console.log(JSON.stringify(res, null, 2))
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
