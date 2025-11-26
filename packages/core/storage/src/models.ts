/**
 * Core data models for the storage layer
 */

/**
 * User model
 */
export interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Workspace model - can be personal or team
 */
export interface Workspace {
  id: string;
  name: string;
  type: 'personal' | 'team';
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Conversation model
 */
export interface Conversation {
  id: string;
  workspace_id: string;
  provider: string;
  external_id: string | null;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Message model
 */
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

/**
 * Memory types - extensible for future apps
 */
export type MemoryType = 'entity' | 'fact' | 'decision' | string;

/**
 * Memory model
 */
export interface Memory {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  type: MemoryType;
  content: string;
  confidence: number;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Relationship model - typed connection between memories
 */
export interface Relationship {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relationship_type: string;
  confidence: number;
  created_at: Date;
}

/**
 * Filter interfaces for queries
 */

export interface ConversationFilters {
  limit?: number;
  offset?: number;
  orderBy?: 'created_at_asc' | 'created_at_desc';
}

export interface MemoryFilters {
  limit?: number;
  offset?: number;
  types?: MemoryType[];
  orderBy?: 'created_at_asc' | 'created_at_desc';
}

export interface SearchQuery {
  text?: string;
  vector?: number[];
  limit?: number;
  types?: MemoryType[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}
