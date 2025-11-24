/**
 * Default memory type configurations
 */

import { MemoryTypeConfig, JSONSchema } from './types.js';

/**
 * Schema for entity metadata
 */
const ENTITY_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'The name of the entity'
    },
    entityType: {
      type: 'string',
      enum: ['person', 'organization', 'place', 'concept'],
      description: 'The type of entity'
    },
    description: {
      type: 'string',
      description: 'A brief description of the entity'
    }
  },
  required: ['name', 'entityType']
};

/**
 * Schema for fact metadata
 */
const FACT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    statement: {
      type: 'string',
      description: 'The factual statement'
    },
    category: {
      type: 'string',
      description: 'The category or domain of the fact (e.g., technical, personal, business)'
    }
  },
  required: ['statement']
};

/**
 * Schema for decision metadata
 */
const DECISION_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      description: 'The decision that was made'
    },
    rationale: {
      type: 'string',
      description: 'The reasoning behind the decision'
    },
    alternatives: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: 'Alternative options that were considered'
    }
  },
  required: ['decision']
};

/**
 * Entity memory type configuration
 */
const ENTITY_CONFIG: MemoryTypeConfig = {
  type: 'entity',
  extractionPrompt: `Extract entities (people, organizations, places, and concepts) mentioned in the conversation.

For each entity, provide:
- name: The name of the entity
- entityType: One of 'person', 'organization', 'place', or 'concept'
- description: A brief description of the entity and its relevance

Focus on entities that are:
- Explicitly mentioned or discussed
- Relevant to the conversation context
- Likely to be referenced again in future conversations

Assign confidence scores based on:
- How clearly the entity is identified (0.9-1.0 for explicit mentions)
- How much context is provided (0.7-0.9 for partial information)
- How ambiguous the reference is (0.5-0.7 for unclear references)`,
  schema: ENTITY_SCHEMA
};

/**
 * Fact memory type configuration
 */
const FACT_CONFIG: MemoryTypeConfig = {
  type: 'fact',
  extractionPrompt: `Extract factual statements and knowledge shared in the conversation.

For each fact, provide:
- statement: The factual statement or piece of knowledge
- category: The domain or category (e.g., 'technical', 'personal', 'business', 'preference')

Focus on facts that are:
- Stated as definitive information
- Likely to be useful for future reference
- Not opinions or speculations (unless explicitly stated as such)

Assign confidence scores based on:
- How definitively the fact is stated (0.9-1.0 for clear statements)
- Whether it's verified or just mentioned (0.7-0.9 for unverified)
- How specific vs. vague the information is (0.5-0.7 for vague)`,
  schema: FACT_SCHEMA
};

/**
 * Decision memory type configuration
 */
const DECISION_CONFIG: MemoryTypeConfig = {
  type: 'decision',
  extractionPrompt: `Extract decisions, choices, and conclusions made during the conversation.

For each decision, provide:
- decision: The decision or choice that was made
- rationale: The reasoning or justification for the decision
- alternatives: Other options that were considered (if mentioned)

Focus on decisions that are:
- Explicitly stated or clearly implied
- Actionable or have consequences
- Relevant for future reference

Assign confidence scores based on:
- How explicitly the decision is stated (0.9-1.0 for clear decisions)
- Whether it's final or tentative (0.7-0.9 for tentative)
- How much context supports the decision (0.5-0.7 for implied)`,
  schema: DECISION_SCHEMA
};

/**
 * Default memory type configurations
 */
export const DEFAULT_MEMORY_TYPES: Record<string, MemoryTypeConfig> = {
  entity: ENTITY_CONFIG,
  fact: FACT_CONFIG,
  decision: DECISION_CONFIG
};

/**
 * Get memory type configuration by type name
 */
export function getMemoryTypeConfig(type: string): MemoryTypeConfig | undefined {
  return DEFAULT_MEMORY_TYPES[type];
}

/**
 * Get all default memory type names
 */
export function getDefaultMemoryTypes(): string[] {
  return Object.keys(DEFAULT_MEMORY_TYPES);
}

/**
 * Check if a memory type is a default type
 */
export function isDefaultMemoryType(type: string): boolean {
  return type in DEFAULT_MEMORY_TYPES;
}
