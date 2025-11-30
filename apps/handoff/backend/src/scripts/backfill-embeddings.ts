#!/usr/bin/env tsx

/**
 * Backfill script to generate embeddings for existing memories
 * 
 * Usage:
 *   npm run backfill-embeddings
 * 
 * Environment variables required:
 *   - SUPABASE_URL
 *   - SUPABASE_KEY
 *   - OPENAI_API_KEY
 *   - OPENAI_EMBEDDING_MODEL (optional, defaults to text-embedding-3-small)
 */

import { DatabaseClient } from '../lib/db'
import { EmbeddingService } from '../services/embedding'

async function backfillEmbeddings() {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    const openaiApiKey = process.env.OPENAI_API_KEY
    const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'

    if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
        console.error('Missing required environment variables')
        console.error('Required: SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY')
        process.exit(1)
    }

    console.log('Initializing services...')
    // Initialize with mockMode: false for the script
    const db = new DatabaseClient(supabaseUrl, supabaseKey, { mockMode: false })
    const embeddingService = new EmbeddingService(openaiApiKey, embeddingModel)

    console.log(`Using embedding model: ${embeddingModel}`)

    // Get all memories without embeddings
    console.log('Fetching memories without embeddings...')
    const memories = await db.query<{ id: string; content: string }>(`
    SELECT id, content
    FROM memories
    WHERE embedding IS NULL
    ORDER BY created_at DESC
  `, [])

    console.log(`Found ${memories.length} memories to process`)

    if (memories.length === 0) {
        console.log('No memories to backfill!')
        return
    }

    // Process in batches of 100
    const batchSize = 100
    let processed = 0
    let failed = 0

    for (let i = 0; i < memories.length; i += batchSize) {
        const batch = memories.slice(i, i + batchSize)
        console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(memories.length / batchSize)} (${batch.length} memories)...`)

        for (const memory of batch) {
            try {
                // Generate embedding
                const embedding = await embeddingService.generateEmbedding(memory.content)

                // Update memory with embedding
                await db.query(`
          UPDATE memories
          SET embedding = $1::vector
          WHERE id = $2
        `, [JSON.stringify(embedding), memory.id])

                processed++

                if (processed % 10 === 0) {
                    console.log(`  Progress: ${processed}/${memories.length}`)
                }
            } catch (error) {
                console.error(`  Failed to process memory ${memory.id}:`, error)
                failed++
            }

            // Rate limit: small delay between requests to avoid hitting OpenAI rate limits
            await new Promise(resolve => setTimeout(resolve, 100))
        }
    }

    console.log(`\n✅ Backfill complete!`)
    console.log(`   Processed: ${processed}`)
    console.log(`   Failed: ${failed}`)
    console.log(`   Total: ${memories.length}`)
}

// Run the backfill
backfillEmbeddings()
    .then(() => {
        console.log('\nDone!')
        process.exit(0)
    })
    .catch(error => {
        console.error('\n❌ Backfill failed:', error)
        process.exit(1)
    })
