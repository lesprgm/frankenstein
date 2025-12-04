/**
 * StructuredOutputStrategy - Uses LLM structured output for reliable memory extraction
 */

import {
  ExtractionStrategy,
  NormalizedConversation,
  NormalizedMessage,
  StrategyConfig,
  RawExtractionResult,
  IncrementalContext,
  ExtractedMemory,
  ExtractedRelationship,
  JSONSchema,
  MemoryTypeConfig
} from '../types.js';
import { DEFAULT_MEMORY_TYPES } from '../memory-types.js';

/**
 * Schema for the structured output from the LLM
 */
interface StructuredExtractionOutput {
  memories: {
    type: string;
    content: string;
    confidence: number;
    metadata: Record<string, any>;
  }[];
  relationships: {
    from_memory_index: number;
    to_memory_index: number;
    relationship_type: string;
    confidence: number;
  }[];
}

/**
 * Context from previous chunk for sequential processing
 */
export interface ChunkContext {
  chunkId: string;
  sequence: number;
  summary: string;
  extractedMemories: Array<{ type: string; content: string }>;
}

/**
 * Helper to create a chunk summary from extracted memories
 */
export function createChunkSummary(
  messages: NormalizedMessage[],
  memories: ExtractedMemory[]
): string {
  const messageCount = messages.length;
  const memoryTypes = [...new Set(memories.map(m => m.type))];
  const keyTopics = memories.slice(0, 3).map(m => m.content).join('; ');
  
  return `Processed ${messageCount} messages. Extracted ${memories.length} memories (${memoryTypes.join(', ')}). Key topics: ${keyTopics}`;
}

/**
 * StructuredOutputStrategy uses LLM structured output (JSON schema) for reliable extraction
 */
export class StructuredOutputStrategy implements ExtractionStrategy {
  readonly name = 'structured-output';

  /**
   * Extract memories from a complete conversation
   */
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult> {
    const prompt = this.buildPrompt(
      conversation.messages,
      config.memoryTypes,
      config.memoryTypeConfigs
    );
    const schema = this.buildSchema(config.memoryTypes, config.memoryTypeConfigs);

    try {
      const result = await config.provider.completeStructured<StructuredExtractionOutput>(
        prompt,
        schema,
        config.modelParams
      );

      return this.transformResult(
        result,
        conversation.id,
        workspaceId,
        conversation.messages.map(m => m.id)
      );
    } catch (error) {
      this.throwWithContext(
        `StructuredOutputStrategy extraction failed for conversation ${conversation.id}`,
        error
      );
    }
  }

  /**
   * Extract memories from a conversation chunk with context from previous chunks
   * 
   * @param messages - Messages in this chunk
   * @param conversationId - The conversation ID
   * @param workspaceId - The workspace ID
   * @param chunkId - The chunk ID
   * @param config - Strategy configuration
   * @param previousChunkContext - Optional context from previous chunk
   * @returns Raw extraction result with chunk ID tagged
   */
  async extractFromChunk(
    messages: NormalizedMessage[],
    conversationId: string,
    workspaceId: string,
    chunkId: string,
    config: StrategyConfig,
    previousChunkContext?: ChunkContext
  ): Promise<RawExtractionResult> {
    const prompt = this.buildChunkPrompt(
      messages,
      config.memoryTypes,
      config.memoryTypeConfigs,
      previousChunkContext
    );
    const schema = this.buildSchema(config.memoryTypes, config.memoryTypeConfigs);

    try {
      const result = await config.provider.completeStructured<StructuredExtractionOutput>(
        prompt,
        schema,
        config.modelParams
      );

      const extractionResult = this.transformResult(
        result,
        conversationId,
        workspaceId,
        messages.map(m => m.id),
        chunkId
      );

      return extractionResult;
    } catch (error) {
      this.throwWithContext(
        `StructuredOutputStrategy chunk extraction failed for chunk ${chunkId}`,
        error
      );
    }
  }

  /**
   * Extract memories from a chunk of messages (for incremental extraction)
   */
  async extractIncremental(
    messages: NormalizedMessage[],
    context: IncrementalContext
  ): Promise<RawExtractionResult> {
    // Build prompt with context of existing memories
    const prompt = this.buildIncrementalPrompt(
      messages,
      context.existingMemories,
      context.messageHistory
    );
    
    const schema = this.buildSchema(['entity', 'fact', 'decision']);

    try {
      const result = await this.extractWithSchema(prompt, schema, context);

      return this.transformResult(
        result,
        context.conversationId,
        context.workspaceId,
        messages.map(m => m.id)
      );
    } catch (error) {
      this.throwWithContext(
        `StructuredOutputStrategy incremental extraction failed for conversation ${context.conversationId}`,
        error
      );
    }
  }

  /**
   * Build extraction prompt for a conversation
   */
  private buildPrompt(
    messages: NormalizedMessage[],
    memoryTypes: string[],
    memoryTypeConfigs?: Map<string, MemoryTypeConfig>
  ): string {
    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const typeInstructions = this.getTypeInstructions(memoryTypes, memoryTypeConfigs);

    return `Analyze the following conversation and extract structured memories.

CONVERSATION:
${conversationText}

INSTRUCTIONS:
Extract the following types of memories from the conversation:

${typeInstructions}

For each memory:
- Assign a confidence score between 0 and 1 (1 = very confident, 0 = uncertain)
- Extract relevant metadata based on the memory type
- Only extract memories that are clearly stated or strongly implied

Also identify relationships between memories:
- works_at: person works at organization
- related_to: general relationship between memories
- depends_on: one memory depends on another
- mentions: one memory mentions another entity

Return your analysis in the structured format.`;
  }

  /**
   * Build extraction prompt for a conversation chunk with previous context
   */
  private buildChunkPrompt(
    messages: NormalizedMessage[],
    memoryTypes: string[],
    memoryTypeConfigs?: Map<string, MemoryTypeConfig>,
    previousChunkContext?: ChunkContext
  ): string {
    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const typeInstructions = this.getTypeInstructions(memoryTypes, memoryTypeConfigs);

    // Build context section if previous chunk exists
    let contextSection = '';
    if (previousChunkContext) {
      contextSection = `
PREVIOUS CHUNK CONTEXT:
This is chunk ${previousChunkContext.sequence + 1} of a larger conversation. The previous chunk contained:

Summary: ${previousChunkContext.summary}

Previously extracted memories:
${previousChunkContext.extractedMemories.map((m, i) => `${i + 1}. [${m.type}] ${m.content}`).join('\n')}

When extracting memories from this chunk:
- Consider the context from the previous chunk
- Avoid duplicating memories already extracted
- You may reference previously extracted memories in relationships
- Focus on NEW information in this chunk
`;
    }

    return `Analyze the following conversation chunk and extract structured memories.
${contextSection}

CURRENT CHUNK:
${conversationText}

INSTRUCTIONS:
Extract the following types of memories from this chunk:

${typeInstructions}

For each memory:
- Assign a confidence score between 0 and 1 (1 = very confident, 0 = uncertain)
- Extract relevant metadata based on the memory type
- Only extract memories that are clearly stated or strongly implied
- Avoid duplicating memories from the previous chunk context

Also identify relationships between memories:
- works_at: person works at organization
- related_to: general relationship between memories
- depends_on: one memory depends on another
- mentions: one memory mentions another entity

Return your analysis in the structured format.`;
  }

  /**
   * Build incremental extraction prompt with context
   */
  private buildIncrementalPrompt(
    newMessages: NormalizedMessage[],
    existingMemories: ExtractedMemory[],
    messageHistory: NormalizedMessage[]
  ): string {
    const newMessagesText = newMessages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const contextText = messageHistory.length > 0
      ? `\n\nPREVIOUS CONTEXT:\n${messageHistory.slice(-3).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`
      : '';

    const existingMemoriesText = existingMemories.length > 0
      ? `\n\nEXISTING MEMORIES:\n${existingMemories.map((m, i) => `${i}. [${m.type}] ${m.content}`).join('\n')}`
      : '';

    return `Analyze the following new messages and extract any NEW memories or relationships.

NEW MESSAGES:
${newMessagesText}
${contextText}
${existingMemoriesText}

INSTRUCTIONS:
Extract NEW memories from the new messages. Focus on:
- Entities (people, organizations, places, concepts)
- Facts (statements, knowledge, information)
- Decisions (choices, conclusions, action items)

Only extract memories that are:
1. Clearly stated in the NEW messages
2. Not already captured in existing memories
3. Have sufficient confidence (> 0.5)

Also identify relationships between memories (both new and existing).

Return your analysis in the structured format.`;
  }

  /**
   * Get type-specific extraction instructions
   */
  private getTypeInstructions(
    memoryTypes: string[],
    memoryTypeConfigs?: Map<string, MemoryTypeConfig>
  ): string {
    const defaultInstructions: Record<string, string> = {
      entity: `ENTITIES: Extract people, organizations, places, and concepts mentioned.
  - name: The entity name
  - entityType: 'person', 'organization', 'place', or 'concept'
  - description: Brief description of the entity`,
      
      fact: `FACTS: Extract factual statements and knowledge shared.
  - statement: The factual statement
  - category: Category of the fact (e.g., 'technical', 'personal', 'business')`,
      
      decision: `DECISIONS: Extract decisions, choices, and conclusions made.
  - decision: The decision made
  - rationale: Why the decision was made
  - alternatives: Other options that were considered`
    };

    return memoryTypes
      .map(type => {
        // Check custom memory type configs first
        const customConfig = memoryTypeConfigs?.get(type.toLowerCase());
        if (customConfig && customConfig.extractionPrompt) {
          return `${type.toUpperCase()}: ${customConfig.extractionPrompt}`;
        }
        
        // Check default memory types
        const defaultConfig = DEFAULT_MEMORY_TYPES[type.toLowerCase()];
        if (defaultConfig && defaultConfig.extractionPrompt) {
          return defaultInstructions[type] || defaultConfig.extractionPrompt;
        }
        
        // Fallback for unknown types
        return `${type.toUpperCase()}: Extract ${type} memories`;
      })
      .join('\n\n');
  }

  /**
   * Build JSON schema for structured output
   */
  private buildSchema(
    memoryTypes: string[],
    memoryTypeConfigs?: Map<string, MemoryTypeConfig>
  ): JSONSchema {
    return {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: memoryTypes
              },
              content: {
                type: 'string',
                description: 'The main content of the memory'
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Confidence score between 0 and 1'
              },
              metadata: {
                type: 'object',
                description: 'Type-specific metadata',
                properties: this.getMetadataSchema(memoryTypes, memoryTypeConfigs)
              }
            },
            required: ['type', 'content', 'confidence', 'metadata']
          }
        },
        relationships: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from_memory_index: {
                type: 'number',
                description: 'Index of the source memory in the memories array'
              },
              to_memory_index: {
                type: 'number',
                description: 'Index of the target memory in the memories array'
              },
              relationship_type: {
                type: 'string',
                enum: ['works_at', 'related_to', 'depends_on', 'mentions', 'part_of', 'created_by']
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1
              }
            },
            required: ['from_memory_index', 'to_memory_index', 'relationship_type', 'confidence']
          }
        }
      },
      required: ['memories', 'relationships']
    };
  }

  /**
   * Get metadata schema for different memory types
   */
  private getMetadataSchema(
    memoryTypes: string[],
    memoryTypeConfigs?: Map<string, MemoryTypeConfig>
  ): Record<string, any> {
    const schemas: Record<string, any> = {};

    for (const type of memoryTypes) {
      const normalizedType = type.toLowerCase();
      
      // Check custom memory type configs first
      const customConfig = memoryTypeConfigs?.get(normalizedType);
      if (customConfig && customConfig.schema && customConfig.schema.properties) {
        // Merge custom schema properties
        Object.assign(schemas, customConfig.schema.properties);
        continue;
      }
      
      // Check default memory types
      const defaultConfig = DEFAULT_MEMORY_TYPES[normalizedType];
      if (defaultConfig && defaultConfig.schema && defaultConfig.schema.properties) {
        // Merge default schema properties
        Object.assign(schemas, defaultConfig.schema.properties);
        continue;
      }
      
      // For unknown types, add basic schema
      if (normalizedType === 'entity') {
        schemas.name = { type: 'string' };
        schemas.entityType = { type: 'string', enum: ['person', 'organization', 'place', 'concept'] };
        schemas.description = { type: 'string' };
      } else if (normalizedType === 'fact') {
        schemas.statement = { type: 'string' };
        schemas.category = { type: 'string' };
      } else if (normalizedType === 'decision') {
        schemas.decision = { type: 'string' };
        schemas.rationale = { type: 'string' };
        schemas.alternatives = { type: 'array', items: { type: 'string' } };
      }
    }

    return schemas;
  }

  /**
   * Extract with schema (helper for incremental extraction)
   */
  private async extractWithSchema(
    prompt: string,
    schema: JSONSchema,
    context: IncrementalContext
  ): Promise<StructuredExtractionOutput> {
    // This would use the provider from context, but we don't have it directly
    // In practice, this will be called from extract/extractIncremental which have the provider
    // For now, return empty structure
    return {
      memories: [],
      relationships: []
    };
  }

  /**
   * Wrap errors with additional context without mutating provider error objects.
   */
  private throwWithContext(prefix: string, err: unknown): never {
    const base = err instanceof Error ? err : new Error(String(err));
    const wrapped = new Error(`${prefix}: ${base.message}`);
    (wrapped as any).cause = base;
    throw wrapped;
  }

  /**
   * Transform LLM result into RawExtractionResult
   */
  private transformResult(
    result: StructuredExtractionOutput,
    conversationId: string,
    workspaceId: string,
    sourceMessageIds: string[],
    chunkId?: string
  ): RawExtractionResult {
    const now = new Date().toISOString();

    // Validate result structure
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid extraction result: result is not an object');
    }
    
    if (!Array.isArray(result.memories)) {
      throw new Error(`Invalid extraction result: memories is not an array (got ${typeof result.memories})`);
    }
    
    if (!Array.isArray(result.relationships)) {
      throw new Error(`Invalid extraction result: relationships is not an array (got ${typeof result.relationships})`);
    }

    // Transform memories
    const memories: Partial<ExtractedMemory>[] = result.memories.map(memory => {
      const extractedMemory: Partial<ExtractedMemory> = {
        type: memory.type,
        content: memory.content,
        confidence: memory.confidence,
        workspace_id: workspaceId,
        conversation_id: conversationId,
        source_message_ids: sourceMessageIds,
        metadata: memory.metadata,
        created_at: now
      };

      // Tag with chunk ID if provided
      if (chunkId) {
        extractedMemory.source_chunks = [chunkId];
      }

      return extractedMemory;
    });

    // Transform relationships
    // Note: IDs will be assigned later by the deduplicator
    const relationships: Partial<ExtractedRelationship>[] = result.relationships
      .filter(rel => {
        // Validate indices are within bounds
        return rel.from_memory_index >= 0 &&
               rel.from_memory_index < memories.length &&
               rel.to_memory_index >= 0 &&
               rel.to_memory_index < memories.length;
      })
      .map(rel => ({
        // Store indices temporarily - will be replaced with actual memory IDs later
        from_memory_id: `temp_${rel.from_memory_index}`,
        to_memory_id: `temp_${rel.to_memory_index}`,
        relationship_type: rel.relationship_type,
        confidence: rel.confidence,
        created_at: now
      }));

    return {
      memories,
      relationships
    };
  }
}
