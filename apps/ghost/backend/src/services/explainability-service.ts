import type { Memory } from '@memorylayer/storage';

/**
 * Graph structure for memory visualization
 */
export interface GraphNode {
    id: string;
    type: 'memory' | 'entity' | 'file' | 'query';
    label: string;
    metadata?: Record<string, any>;
    confidence?: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    weight: number;  // 0-1, represents similarity/strength
    type: 'similarity' | 'relationship' | 'reference';
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * Reasoning path for timeline visualization
 */
export interface ReasoningStep {
    step: number;
    action: string;
    description: string;
    timestamp: string;
    metadata?: Record<string, any>;
}

export interface ReasoningPath {
    query: string;
    steps: ReasoningStep[];
    retrievedCount: number;
    topMatches: Array<{
        memoryId: string;
        score: number;
        summary: string;
    }>;
}

/**
 * Complete explanation context
 */
export interface ExplanationContext {
    commandId: string;
    commandText: string;
    userQuery: string;
    reasoning: ReasoningPath;
    graph: GraphData;
    memories: Memory[];
    createdAt: string;
}

/**
 * Service for managing AI explainability data
 */
export class ExplainabilityService {
    constructor(private db: any) { }

    /**
     * Store explanation context for a command
     */
    async storeExplanation(context: ExplanationContext): Promise<void> {
        const stmt = this.db.prepare(`
      INSERT INTO explanation_contexts (
        command_id, command_text, user_query, reasoning_data, graph_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

        stmt.run(
            context.commandId,
            context.commandText,
            context.userQuery,
            JSON.stringify(context.reasoning),
            JSON.stringify(context.graph),
            context.createdAt || new Date().toISOString()
        );
    }

    /**
     * Retrieve explanation context by command ID
     */
    async getExplanation(commandId: string): Promise<ExplanationContext | null> {
        const row = this.db
            .prepare('SELECT * FROM explanation_contexts WHERE command_id = ?')
            .get(commandId);

        if (!row) return null;

        return {
            commandId: row.command_id,
            commandText: row.command_text,
            userQuery: row.user_query,
            reasoning: JSON.parse(row.reasoning_data),
            graph: JSON.parse(row.graph_data),
            memories: [], // Fetch separately if needed
            createdAt: row.created_at,
        };
    }

    /**
     * Build memory graph from memories and their relationships
     */
    buildMemoryGraph(memories: Memory[], query: string): GraphData {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        // Add query node
        nodes.push({
            id: 'query',
            type: 'query',
            label: query,
        });

        // Add memory nodes
        memories.forEach((memory, idx) => {
            const nodeId = `memory-${memory.id}`;

            nodes.push({
                id: nodeId,
                type: 'memory',
                label: this.summarizeContent(memory.content),
                metadata: {
                    type: memory.type,
                    source: memory.metadata?.source,
                    createdAt: memory.created_at,
                },
                confidence: memory.confidence,
            });

            // Connect query to memory (similarity edge)
            edges.push({
                source: 'query',
                target: nodeId,
                weight: memory.confidence || 0.5,
                type: 'similarity',
            });

            // Extract entities from memory
            const entities = this.extractEntities(memory);
            entities.forEach((entity) => {
                const entityId = `entity-${entity.toLowerCase().replace(/\s+/g, '-')}`;

                // Add entity node if not exists
                if (!nodes.find((n) => n.id === entityId)) {
                    nodes.push({
                        id: entityId,
                        type: 'entity',
                        label: entity,
                    });
                }

                // Connect memory to entity
                edges.push({
                    source: nodeId,
                    target: entityId,
                    weight: 0.7,
                    type: 'reference',
                });
            });

            // Add file/source node if available
            if (memory.metadata?.source) {
                const sourceId = `file-${memory.metadata.source}`;

                if (!nodes.find((n) => n.id === sourceId)) {
                    nodes.push({
                        id: sourceId,
                        type: 'file',
                        label: memory.metadata.source,
                    });
                }

                edges.push({
                    source: nodeId,
                    target: sourceId,
                    weight: 0.8,
                    type: 'reference',
                });
            }
        });

        return { nodes, edges };
    }

    /**
     * Summarize content for node labels (max 50 chars)
     */
    private summarizeContent(content: string): string {
        const maxLength = 50;
        if (content.length <= maxLength) return content;
        return content.substring(0, maxLength - 3) + '...';
    }

    /**
     * Extract entities from memory content
     * Simple implementation - looks for capitalized words
     */
    private extractEntities(memory: Memory): string[] {
        const entities: string[] = [];

        // Extract from content
        const words = memory.content.split(/\s+/);
        const capitalized = words.filter(
            (word) => word.length > 2 && /^[A-Z]/.test(word) && !/^[A-Z]+$/.test(word)
        );

        entities.push(...capitalized.slice(0, 3)); // Limit to 3 entities per memory

        return [...new Set(entities)]; // Remove duplicates
    }

    /**
     * Cleanup old explanations (older than 7 days)
     */
    async cleanupOldExplanations(): Promise<number> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const stmt = this.db.prepare(
            'DELETE FROM explanation_contexts WHERE created_at < ?'
        );

        const result = stmt.run(sevenDaysAgo);
        return result.changes;
    }
}
