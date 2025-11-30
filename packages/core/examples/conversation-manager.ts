/**
 * Conversation Manager Example - How Handoff uses MemoryLayer
 * 
 * This shows the configuration pattern used in Handoff for knowledge extraction
 * from team conversations.
 */

import { MemoryLayer } from '../src/index.js';
import { StorageConfig } from '@memorylayer/storage';

// Handoff configuration: Production Postgres with Vectorize
const config: StorageConfig = {
    postgres: {
        url: process.env.SUPABASE_URL!,
        apiKey: process.env.SUPABASE_KEY!
    },
    vectorize: {
        mode: 'cloudflare',
        accountId: process.env.CF_ACCOUNT_ID!,
        apiToken: process.env.CF_API_TOKEN!,
        indexName: 'memories'
    }
};

const ml = new MemoryLayer({
    storage: config,
    apiKey: process.env.OPENAI_API_KEY,
    memoryTypes: ['entity', 'fact', 'decision', 'task'], // Handoff-specific types
    minConfidence: 0.6
});

// Extract memories from a team conversation
const conversation = `
Alice: We need to finalize the database choice for Project Alpha.
Bob: I vote PostgreSQL. It has better JSONB support than MySQL.
Alice: Agreed. Let's use Supabase for hosting.
Bob: Perfect. I'll set it up by Friday.
`;

await ml.extract(conversation, {
    types: ['entity', 'decision', 'task']
});

// Search for decisions made
const decisions = await ml.search("database decisions", {
    types: ['decision'],
    limit: 10
});

console.log('Decisions:', decisions);

// Build context for AI brief generation
const briefContext = await ml.buildContext("summarize technical decisions", {
    includeRelationships: true,
    tokenBudget: 2000,
    types: ['decision', 'task']
});

console.log('Brief Context:', briefContext);
