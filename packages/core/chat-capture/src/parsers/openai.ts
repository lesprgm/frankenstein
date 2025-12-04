/**
 * OpenAI ChatGPT conversation parser
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.3, 3.4
 */

import { BaseParser } from './base';
import { NormalizedConversation, NormalizedMessage } from '../types';

/**
 * OpenAI export format interfaces
 * Based on ChatGPT conversation export structure
 */
interface OpenAIExport {
  // Single conversation format
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, OpenAIMessageNode>;
  conversation_id?: string;
  
  // Multi-conversation format
  conversations?: OpenAIConversation[];
}

interface OpenAIConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, OpenAIMessageNode>;
  conversation_id?: string;
  [key: string]: any;
}

interface OpenAIMessageNode {
  id: string;
  message?: OpenAIMessage | null;
  parent?: string | null;
  children?: string[];
}

interface OpenAIMessage {
  id: string;
  author?: {
    role?: string;
    [key: string]: any;
  };
  content?: {
    content_type?: string;
    parts?: string[];
    [key: string]: any;
  };
  create_time?: number;
  update_time?: number;
  [key: string]: any;
}

/**
 * Parser for OpenAI ChatGPT conversation exports
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */
export class OpenAIParser extends BaseParser {
  readonly provider = 'openai';

  /**
   * Check if data matches ChatGPT export structure
   * Requirements: 4.2
   */
  canParse(data: unknown): boolean {
    // Newer HTML exports often embed an array of conversations directly
    if (Array.isArray(data)) {
      const first = data[0];
      if (first && typeof first === 'object' && (this.hasProperty(first, 'mapping') || this.hasProperty(first, 'conversation_id'))) {
        return true;
      }
    }

    if (!this.hasProperty(data, 'mapping') && !this.hasProperty(data, 'conversations')) {
      return false;
    }

    // Check for single conversation format
    if (this.hasProperty(data, 'mapping')) {
      return true;
    }

    // Check for multi-conversation format
    if (this.hasProperty(data, 'conversations')) {
      const conversations = this.getProperty<any[]>(data, 'conversations');
      return Array.isArray(conversations) && conversations.length > 0;
    }

    return false;
  }

  /**
   * Parse ChatGPT export into normalized conversations
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 7.3, 7.5
   */
  async parse(data: unknown): Promise<NormalizedConversation[]> {
    try {
      const exportData = data as OpenAIExport;
      const conversations: NormalizedConversation[] = [];

      // Handle multi-conversation format
      if (exportData.conversations && Array.isArray(exportData.conversations)) {
        for (let i = 0; i < exportData.conversations.length; i++) {
          try {
            const conv = exportData.conversations[i];
            const normalized = this.parseConversation(conv);
            if (normalized) {
              conversations.push(normalized);
            }
          } catch (error) {
            // Log error with context but continue processing other conversations
            // Requirement 7.3: Include provider and error location
            // Requirement 7.5: Log parsing errors with sufficient context
            throw new Error(
              `Failed to parse conversation at index ${i}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }
      // Handle array of conversations (e.g., HTML exports with embedded JSON)
      else if (Array.isArray(exportData)) {
        for (let i = 0; i < exportData.length; i++) {
          const conv = exportData[i] as OpenAIConversation;
          const normalized = this.parseConversation(conv);
          if (normalized) {
            conversations.push(normalized);
          }
        }
      }
      // Handle single conversation format
      else if (exportData.mapping) {
        const normalized = this.parseConversation(exportData as OpenAIConversation);
        if (normalized) {
          conversations.push(normalized);
        }
      } else {
        // Requirement 7.3: Include provider and error location
        throw new Error(
          'Invalid OpenAI export format: missing "mapping" or "conversations" field'
        );
      }

      return conversations;
    } catch (error) {
      // Requirement 7.3: Include provider and error location
      // Requirement 7.5: Add context to all error messages
      throw new Error(
        `OpenAI parser error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse a single conversation from OpenAI format
   * Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 7.3, 7.5
   */
  private parseConversation(conv: OpenAIConversation): NormalizedConversation | null {
    try {
      if (!conv.mapping) {
        return null;
      }

      // Extract messages from mapping structure
      const messages = this.extractMessages(conv.mapping);

      // Skip conversations with no messages
      if (messages.length === 0) {
        return null;
      }

      // Extract metadata
      const conversationId = this.generateId();
      const externalId = conv.conversation_id || null;
      const title = conv.title || null;
      const createdAt = this.normalizeTimestamp(conv.create_time || messages[0]?.created_at);
      const updatedAt = this.normalizeTimestamp(
        conv.update_time || messages[messages.length - 1]?.created_at
      );

      // Build raw metadata (preserve provider-specific fields)
      const raw_metadata: Record<string, any> = {};
      for (const [key, value] of Object.entries(conv)) {
        if (!['title', 'create_time', 'update_time', 'mapping', 'conversation_id'].includes(key)) {
          raw_metadata[key] = value;
        }
      }

      return {
        id: conversationId,
        provider: this.provider,
        external_id: externalId,
        title,
        created_at: createdAt,
        updated_at: updatedAt,
        messages,
        raw_metadata,
      };
    } catch (error) {
      // Requirement 7.3: Include provider and error location
      // Requirement 7.5: Add context to all error messages
      const convId = conv.conversation_id || 'unknown';
      throw new Error(
        `Failed to parse OpenAI conversation (id: ${convId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Extract and order messages from OpenAI's mapping structure
   * Requirements: 1.3, 1.4, 1.5, 1.7, 3.4
   */
  private extractMessages(mapping: Record<string, OpenAIMessageNode>): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    const processedIds = new Set<string>();

    // Find the root node (node with no parent or parent not in mapping)
    let rootId: string | null = null;
    for (const [id, node] of Object.entries(mapping)) {
      if (!node.parent || !mapping[node.parent]) {
        rootId = id;
        break;
      }
    }

    if (!rootId) {
      // Fallback: use first node if no clear root
      rootId = Object.keys(mapping)[0];
    }

    // Traverse the conversation tree depth-first
    const traverse = (nodeId: string) => {
      if (processedIds.has(nodeId)) {
        return;
      }

      const node = mapping[nodeId];
      if (!node) {
        return;
      }

      processedIds.add(nodeId);

      // Process current message if it exists
      if (node.message) {
        const normalizedMessage = this.normalizeMessage(node.message);
        if (normalizedMessage) {
          messages.push(normalizedMessage);
        }
      }

      // Process children in order
      if (node.children && Array.isArray(node.children)) {
        for (const childId of node.children) {
          traverse(childId);
        }
      }
    };

    traverse(rootId);

    return messages;
  }

  /**
   * Normalize a single OpenAI message
   * Requirements: 1.3, 1.5, 1.7, 3.3, 3.4
   */
  private normalizeMessage(message: OpenAIMessage): NormalizedMessage | null {
    // Extract role
    const role = message.author?.role || 'assistant';
    const normalizedRole = this.normalizeRole(role);

    // Extract content - preserve exactly as provided
    let content = '';
    if (message.content?.parts && Array.isArray(message.content.parts)) {
      // Join parts with newlines to preserve structure
      content = message.content.parts
        .filter((part) => typeof part === 'string')
        .join('\n');
    }

    // Skip messages with no content
    if (!content.trim()) {
      return null;
    }

    // Generate timestamp
    const createdAt = this.normalizeTimestamp(message.create_time);

    // Build raw metadata
    const raw_metadata: Record<string, any> = {};
    for (const [key, value] of Object.entries(message)) {
      if (!['id', 'author', 'content', 'create_time', 'update_time'].includes(key)) {
        raw_metadata[key] = value;
      }
    }

    // Preserve content metadata
    if (message.content) {
      raw_metadata.content_type = message.content.content_type;
      for (const [key, value] of Object.entries(message.content)) {
        if (!['content_type', 'parts'].includes(key)) {
          raw_metadata[`content_${key}`] = value;
        }
      }
    }

    return {
      id: this.generateId(),
      role: normalizedRole,
      content,
      created_at: createdAt,
      raw_metadata,
    };
  }
}
