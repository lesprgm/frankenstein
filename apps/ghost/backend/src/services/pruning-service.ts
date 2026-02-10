import { storageService } from './storage.js';

export class PruningService {
    async prune(): Promise<void> {
        console.log('[Ghost] Starting memory pruning...');
        
        const rules = [
            // Short-term (7 days) - Ephemeral context & Commands
            { type: 'context.screen', maxAgeDays: 7 },
            { type: 'context.clipboard', maxAgeDays: 7 },
            { type: 'fact.command', maxAgeDays: 7 },
            { type: 'fact.action', maxAgeDays: 7 },
            
            // Medium-term (30 days) - Recent interactions
            { type: 'fact.recent', maxAgeDays: 30 },
            { type: 'fact.conversation', maxAgeDays: 30 }, // Chat logs
            { type: 'fact.response', maxAgeDays: 30 },
            { type: 'conversation.turn', maxAgeDays: 30 }, // Just in case
        ];

        try {
            const count = await storageService.pruneMemories(rules);
            console.log(`[Ghost] Pruned ${count} old memories.`);
        } catch (error) {
            console.error('[Ghost] Pruning failed:', error);
        }
    }
}

export const pruningService = new PruningService();
