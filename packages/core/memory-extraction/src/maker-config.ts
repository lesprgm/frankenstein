/**
 * MAKER Reliability Layer Configuration
 * 
 * Controls the behavior of the MAKER-inspired reliability layer for memory extraction.
 * Based on the MAKER framework (Maximal Agentic decomposition, K-threshold Error mitigation, Red-flagging).
 */

export const makerConfig = {
    /** Enable/disable MAKER reliability layer (feature flag) */
    enabled: process.env.MAKER_ENABLED !== 'false',  // Default: enabled unless explicitly disabled

    /** Number of parallel microagents to run for consensus */
    replicas: parseInt(process.env.MAKER_REPLICAS || '3', 10),

    /** K-threshold for voting (simple 2-of-3 majority) */
    voteK: parseInt(process.env.MAKER_VOTE_K || '2', 10),

    /** Maximum retry attempts if all microagents fail */
    maxRetries: parseInt(process.env.MAKER_MAX_RETRIES || '1', 10),

    /** Temperature for microagent LLM calls (lower = more consistent) */
    temperature: parseFloat(process.env.MAKER_TEMPERATURE || '0.4'),

    /** Timeout per microagent call in milliseconds */
    timeout: parseInt(process.env.MAKER_TIMEOUT || '10000', 10),

    /** Model to use for microagents (defaults to latest Flash model) */
    model: process.env.MAKER_MODEL || 'gemini-flash-latest',
} as const;

/**
 * Log configuration on module load
 */
if (makerConfig.enabled) {
    console.info('[MAKER Config] Reliability layer enabled:', {
        replicas: makerConfig.replicas,
        voteK: makerConfig.voteK,
        model: makerConfig.model,
        temperature: makerConfig.temperature,
    });
} else {
    console.info('[MAKER Config] Reliability layer disabled');
}
