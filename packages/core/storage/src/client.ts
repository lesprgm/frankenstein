/**
 * StorageClient - Main entry point for all storage operations
 */

import { PostgresAdapter, PostgresConfig } from './postgres.js';
import { SqliteAdapter, SqliteConfig } from './sqlite.js';
import { StorageAdapter, Transaction } from './adapter.js';
import { VectorizeAdapter, VectorizeConfig } from './vectorize.js';
import { Result, StorageError } from './errors.js';
import { User, Workspace, Conversation, ConversationFilters, Message, Memory, MemoryType, MemoryFilters, SearchQuery, SearchResult, Relationship, LifecycleState } from './models.js';

/**
 * Logger interface for internal error tracking
 */
export interface Logger {
  error(message: string, context?: object): void;
  warn(message: string, context?: object): void;
  info(message: string, context?: object): void;
}

/**
 * Default console logger implementation
 */
const defaultLogger: Logger = {
  error: (message: string, context?: object) => console.error(message, context),
  warn: (message: string, context?: object) => console.warn(message, context),
  info: (message: string, context?: object) => console.info(message, context),
};

/**
 * Configuration for StorageClient
 */
export interface StorageConfig {
  postgres?: PostgresConfig;
  sqlite?: SqliteConfig;
  vectorize: VectorizeConfig;
  logger?: Logger;
}

/**
 * Input types for create operations
 */
export interface CreateUserInput {
  id?: string;
  email: string;
  name: string;
}

export interface CreateWorkspaceInput {
  id?: string;
  name: string;
  type: 'personal' | 'team';
  owner_id: string;
}

export interface CreateConversationInput {
  workspace_id: string;
  provider: string;
  external_id?: string | null;
  title?: string | null;
}

export interface CreateMessageInput {
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CreateMemoryInput {
  workspace_id: string;
  conversation_id?: string | null;
  type: MemoryType;
  content: string;
  confidence: number;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface CreateRelationshipInput {
  from_memory_id: string;
  to_memory_id: string;
  relationship_type: string;
  confidence: number;
}

/**
 * StorageClient provides a unified interface for all storage operations
 */
export class StorageClient {
  private adapter: StorageAdapter;
  private vectorize: VectorizeAdapter;
  private logger: Logger;

  constructor(config: StorageConfig) {
    if (config.sqlite) {
      this.adapter = new SqliteAdapter(config.sqlite);
    } else if (config.postgres) {
      this.adapter = new PostgresAdapter(config.postgres);
    } else {
      throw new Error('Either postgres or sqlite config must be provided');
    }

    this.vectorize = new VectorizeAdapter(config.vectorize);
    this.logger = config.logger || defaultLogger;
  }

  /**
   * Create a new user
   */
  async createUser(data: CreateUserInput): Promise<Result<User, StorageError>> {
    // Validate input
    if (!data.email || !data.email.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'email',
          message: 'Email is required',
        },
      };
    }

    if (!data.name || !data.name.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'name',
          message: 'Name is required',
        },
      };
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'email',
          message: 'Invalid email format',
        },
      };
    }

    try {
      const result = await this.adapter.insert<User>('users', {
        ...(data.id ? { id: data.id } : {}),
        email: data.email.trim(),
        name: data.name.trim(),
      });

      if (!result.ok) {
        this.logger.error('Failed to create user', {
          email: data.email,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Unexpected error creating user', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create user',
          cause: error,
        },
      };
    }
  }

  /**
   * Get a user by ID
   */
  async getUser(id: string): Promise<Result<User | null, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'User ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<User>(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );

      if (!result.ok) {
        this.logger.error('Failed to get user', { id, error: result.error });
        return result;
      }

      // Return null if user not found
      if (result.value.length === 0) {
        return { ok: true, value: null };
      }

      return { ok: true, value: result.value[0] };
    } catch (error) {
      this.logger.error('Unexpected error getting user', { id, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get user',
          cause: error,
        },
      };
    }
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(data: CreateWorkspaceInput): Promise<Result<Workspace, StorageError>> {
    // Validate input
    if (!data.name || !data.name.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'name',
          message: 'Workspace name is required',
        },
      };
    }

    if (!data.owner_id || !data.owner_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'owner_id',
          message: 'Owner ID is required',
        },
      };
    }

    // Validate workspace type
    if (data.type !== 'personal' && data.type !== 'team') {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'type',
          message: 'Workspace type must be either "personal" or "team"',
        },
      };
    }

    try {
      const result = await this.adapter.insert<Workspace>('workspaces', {
        ...(data.id ? { id: data.id } : {}),
        name: data.name.trim(),
        type: data.type,
        owner_id: data.owner_id,
      });

      if (!result.ok) {
        this.logger.error('Failed to create workspace', {
          name: data.name,
          type: data.type,
          owner_id: data.owner_id,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Unexpected error creating workspace', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create workspace',
          cause: error,
        },
      };
    }
  }

  /**
   * Get a workspace by ID
   */
  async getWorkspace(id: string): Promise<Result<Workspace | null, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<Workspace>(
        'SELECT * FROM workspaces WHERE id = $1',
        [id]
      );

      if (!result.ok) {
        this.logger.error('Failed to get workspace', { id, error: result.error });
        return result;
      }

      // Return null if workspace not found
      if (result.value.length === 0) {
        return { ok: true, value: null };
      }

      return { ok: true, value: result.value[0] };
    } catch (error) {
      this.logger.error('Unexpected error getting workspace', { id, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get workspace',
          cause: error,
        },
      };
    }
  }

  /**
   * List all workspaces owned by a user
   */
  async listUserWorkspaces(userId: string): Promise<Result<Workspace[], StorageError>> {
    if (!userId || !userId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'userId',
          message: 'User ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<Workspace>(
        'SELECT * FROM workspaces WHERE owner_id = $1 ORDER BY created_at DESC',
        [userId]
      );

      if (!result.ok) {
        this.logger.error('Failed to list user workspaces', {
          userId,
          error: result.error,
        });
        return result;
      }

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error listing user workspaces', { userId, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to list user workspaces',
          cause: error,
        },
      };
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(data: CreateConversationInput): Promise<Result<Conversation, StorageError>> {
    // Validate input
    if (!data.workspace_id || !data.workspace_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspace_id',
          message: 'Workspace ID is required',
        },
      };
    }

    if (!data.provider || !data.provider.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'provider',
          message: 'Provider is required',
        },
      };
    }

    // Verify workspace exists
    const workspaceResult = await this.getWorkspace(data.workspace_id);
    if (!workspaceResult.ok) {
      return workspaceResult as Result<never, StorageError>;
    }

    if (workspaceResult.value === null) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspace_id',
          message: 'Workspace does not exist',
        },
      };
    }

    try {
      const result = await this.adapter.insert<Conversation>('conversations', {
        workspace_id: data.workspace_id.trim(),
        provider: data.provider.trim(),
        external_id: data.external_id || null,
        title: data.title || null,
      });

      if (!result.ok) {
        this.logger.error('Failed to create conversation', {
          workspace_id: data.workspace_id,
          provider: data.provider,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Unexpected error creating conversation', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create conversation',
          cause: error,
        },
      };
    }
  }

  /**
   * Get a conversation by ID with workspace scoping
   */
  async getConversation(id: string, workspaceId: string): Promise<Result<Conversation | null, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'Conversation ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<Conversation>(
        'SELECT * FROM conversations WHERE id = $1 AND workspace_id = $2',
        [id, workspaceId]
      );

      if (!result.ok) {
        this.logger.error('Failed to get conversation', {
          id,
          workspaceId,
          error: result.error,
        });
        return result;
      }

      // Return null if conversation not found or doesn't belong to workspace
      if (result.value.length === 0) {
        return { ok: true, value: null };
      }

      return { ok: true, value: result.value[0] };
    } catch (error) {
      this.logger.error('Unexpected error getting conversation', { id, workspaceId, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get conversation',
          cause: error,
        },
      };
    }
  }

  /**
   * List conversations for a workspace with pagination and ordering
   */
  async listConversations(
    workspaceId: string,
    filters?: ConversationFilters
  ): Promise<Result<Conversation[], StorageError>> {
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    // Set defaults for pagination
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const orderBy = filters?.orderBy ?? 'created_at_desc';

    // Validate limit and offset
    if (limit < 1 || limit > 1000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 1000',
        },
      };
    }

    if (offset < 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'offset',
          message: 'Offset must be non-negative',
        },
      };
    }

    // Build ORDER BY clause
    const orderClause = orderBy === 'created_at_asc' ? 'created_at ASC' : 'created_at DESC';

    try {
      const result = await this.adapter.query<Conversation>(
        `SELECT * FROM conversations WHERE workspace_id = $1 ORDER BY ${orderClause} LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      );

      if (!result.ok) {
        this.logger.error('Failed to list conversations', {
          workspaceId,
          filters,
          error: result.error,
        });
        return result;
      }

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error listing conversations', {
        workspaceId,
        filters,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to list conversations',
          cause: error,
        },
      };
    }
  }

  /**
   * Create a new message
   */
  async createMessage(data: CreateMessageInput): Promise<Result<Message, StorageError>> {
    // Validate input
    if (!data.conversation_id || !data.conversation_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'conversation_id',
          message: 'Conversation ID is required',
        },
      };
    }

    if (!data.role || !['user', 'assistant', 'system'].includes(data.role)) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'role',
          message: 'Role must be user, assistant, or system',
        },
      };
    }

    if (!data.content || !data.content.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'content',
          message: 'Content is required',
        },
      };
    }

    try {
      const result = await this.adapter.insert<Message>('messages', {
        conversation_id: data.conversation_id.trim(),
        role: data.role,
        content: data.content.trim(),
      });

      if (!result.ok) {
        this.logger.error('Failed to create message', {
          conversation_id: data.conversation_id,
          role: data.role,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Unexpected error creating message', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create message',
          cause: error,
        },
      };
    }
  }

  /**
   * List messages for a conversation
   */
  async listMessages(conversationId: string): Promise<Result<Message[], StorageError>> {
    if (!conversationId || !conversationId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'conversationId',
          message: 'Conversation ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<Message>(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conversationId]
      );

      if (!result.ok) {
        this.logger.error('Failed to list messages', {
          conversationId,
          error: result.error,
        });
        return result;
      }

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error listing messages', { conversationId, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to list messages',
          cause: error,
        },
      };
    }
  }

  /**
   * Create a new memory with optional embedding
   */
  async createMemory(data: CreateMemoryInput): Promise<Result<Memory, StorageError>> {
    // Validate input
    if (!data.workspace_id || !data.workspace_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspace_id',
          message: 'Workspace ID is required',
        },
      };
    }

    if (!data.type || !data.type.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'type',
          message: 'Memory type is required',
        },
      };
    }

    if (!data.content || !data.content.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'content',
          message: 'Memory content is required',
        },
      };
    }

    // Validate confidence range
    if (data.confidence < 0 || data.confidence > 1) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'confidence',
          message: 'Confidence must be between 0 and 1',
        },
      };
    }

    // Verify workspace exists
    const workspaceResult = await this.getWorkspace(data.workspace_id);
    if (!workspaceResult.ok) {
      return workspaceResult as Result<never, StorageError>;
    }

    if (workspaceResult.value === null) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspace_id',
          message: 'Workspace does not exist',
        },
      };
    }

    // If conversation_id is provided, verify it exists and belongs to the workspace
    if (data.conversation_id) {
      const conversationResult = await this.getConversation(
        data.conversation_id,
        data.workspace_id
      );
      if (!conversationResult.ok) {
        return conversationResult as Result<never, StorageError>;
      }

      if (conversationResult.value === null) {
        return {
          ok: false,
          error: {
            type: 'validation',
            field: 'conversation_id',
            message: 'Conversation does not exist or does not belong to the workspace',
          },
        };
      }
    }

    try {
      // Insert memory into database with lifecycle fields initialized
      const now = new Date();
      const memoryData = {
        workspace_id: data.workspace_id.trim(),
        conversation_id: data.conversation_id || null,
        type: data.type.trim(),
        content: data.content.trim(),
        confidence: data.confidence,
        metadata: data.metadata || {},
        // Initialize lifecycle management fields
        lifecycle_state: 'active' as LifecycleState,
        last_accessed_at: now,
        access_count: 0,
        importance_score: 0.5, // Default medium importance
        decay_score: 1.0, // Start with maximum freshness
        effective_ttl: null,
        pinned: false,
        pinned_by: null,
        pinned_at: null,
        archived_at: null,
        expires_at: null,
      };

      const result = await this.adapter.insert<Memory>('memories', memoryData);

      if (!result.ok) {
        this.logger.error('Failed to create memory', {
          workspace_id: data.workspace_id,
          type: data.type,
          error: result.error,
        });
        return result;
      }

      const memory = result.value;

      // If embedding is provided, store it in Vectorize
      if (data.embedding && data.embedding.length > 0) {
        this.logger.info('Storing memory embedding in Vectorize', {
          memory_id: memory.id,
          workspace_id: memory.workspace_id,
          type: memory.type,
        });

        const vectorResult = await this.vectorize.upsert(memory.id, data.embedding, {
          workspace_id: memory.workspace_id,
          type: memory.type,
        });

        if (!vectorResult.ok) {
          this.logger.error('Failed to store embedding in Vectorize', {
            memory_id: memory.id,
            error: vectorResult.error,
          });

          // Rollback: delete the memory from Postgres
          await this.adapter.delete('memories', memory.id);

          return {
            ok: false,
            error: vectorResult.error,
          };
        }

        this.logger.info('Successfully stored memory embedding', {
          memory_id: memory.id,
        });
      }

      return { ok: true, value: memory };
    } catch (error) {
      this.logger.error('Unexpected error creating memory', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Get a memory by ID with workspace scoping
   */
  async getMemory(id: string, workspaceId: string): Promise<Result<Memory | null, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'Memory ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      const result = await this.adapter.query<Memory>(
        'SELECT * FROM memories WHERE id = $1 AND workspace_id = $2',
        [id, workspaceId]
      );

      if (!result.ok) {
        this.logger.error('Failed to get memory', {
          id,
          workspaceId,
          error: result.error,
        });
        return result;
      }

      // Return null if memory not found or doesn't belong to workspace
      if (result.value.length === 0) {
        return { ok: true, value: null };
      }

      const memory = result.value[0];

      // Track access (non-blocking, fire-and-forget)
      // Don't await to avoid slowing down reads
      this.adapter.query(
        `UPDATE memories 
         SET access_count = access_count + 1, 
             last_accessed_at = $1 
         WHERE id = $2`,
        [new Date().toISOString(), id]
      ).catch((error) => {
        // Log error but don't fail the read operation
        this.logger.warn('Failed to update access tracking', {
          memory_id: id,
          error,
        });
      });

      return { ok: true, value: memory };
    } catch (error) {
      this.logger.error('Unexpected error getting memory', { id, workspaceId, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get memory',
          cause: error,
        },
      };
    }
  }

  /**
   * List memories for a workspace with filtering, pagination, and ordering
   */
  async listMemories(
    workspaceId: string,
    filters?: MemoryFilters
  ): Promise<Result<Memory[], StorageError>> {
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    // Set defaults for pagination
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const orderBy = filters?.orderBy ?? 'created_at_desc';

    // Validate limit and offset
    if (limit < 1 || limit > 1000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 1000',
        },
      };
    }

    if (offset < 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'offset',
          message: 'Offset must be non-negative',
        },
      };
    }

    // Build ORDER BY clause
    const orderClause = orderBy === 'created_at_asc' ? 'created_at ASC' : 'created_at DESC';

    try {
      let query: string;
      let params: any[];

      // Build query with optional type filtering
      if (filters?.types && filters.types.length > 0) {
        query = `SELECT * FROM memories WHERE workspace_id = $1 AND type = ANY($2) ORDER BY ${orderClause} LIMIT $3 OFFSET $4`;
        params = [workspaceId, filters.types, limit, offset];
      } else {
        query = `SELECT * FROM memories WHERE workspace_id = $1 ORDER BY ${orderClause} LIMIT $2 OFFSET $3`;
        params = [workspaceId, limit, offset];
      }

      const result = await this.adapter.query<Memory>(query, params);

      if (!result.ok) {
        this.logger.error('Failed to list memories', {
          workspaceId,
          filters,
          error: result.error,
        });
        return result;
      }

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error listing memories', {
        workspaceId,
        filters,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to list memories',
          cause: error,
        },
      };
    }
  }

  /**
   * Get memories by lifecycle state
   */
  async getMemoriesByLifecycleState(
    workspaceId: string,
    state: LifecycleState,
    options?: { limit?: number; offset?: number }
  ): Promise<Result<Memory[], StorageError>> {
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    // Validate lifecycle state
    const validStates: LifecycleState[] = ['active', 'decaying', 'archived', 'expired', 'pinned'];
    if (!validStates.includes(state)) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'state',
          message: `Invalid lifecycle state. Must be one of: ${validStates.join(', ')}`,
        },
      };
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Validate limit and offset
    if (limit < 1 || limit > 1000) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 1000',
        },
      };
    }

    if (offset < 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'offset',
          message: 'Offset must be non-negative',
        },
      };
    }

    try {
      const result = await this.adapter.query<Memory>(
        `SELECT * FROM memories 
         WHERE workspace_id = $1 AND lifecycle_state = $2 
         ORDER BY created_at DESC 
         LIMIT $3 OFFSET $4`,
        [workspaceId, state, limit, offset]
      );

      if (!result.ok) {
        this.logger.error('Failed to get memories by lifecycle state', {
          workspaceId,
          state,
          error: result.error,
        });
        return result;
      }

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error getting memories by lifecycle state', {
        workspaceId,
        state,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get memories by lifecycle state',
          cause: error,
        },
      };
    }
  }

  /**
   * Update memory lifecycle fields
   */
  async updateMemoryLifecycle(
    id: string,
    workspaceId: string,
    updates: {
      lifecycle_state?: LifecycleState;
      importance_score?: number;
      decay_score?: number;
      pinned?: boolean;
    }
  ): Promise<Result<Memory, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'Memory ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    // Validate input
    if (updates.importance_score !== undefined && (updates.importance_score < 0 || updates.importance_score > 1)) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'importance_score',
          message: 'Importance score must be between 0 and 1',
        },
      };
    }

    if (updates.decay_score !== undefined && (updates.decay_score < 0 || updates.decay_score > 1)) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'decay_score',
          message: 'Decay score must be between 0 and 1',
        },
      };
    }

    try {
      // Build update query dynamically based on provided fields
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (updates.lifecycle_state !== undefined) {
        updateFields.push(`lifecycle_state = $${paramIndex++}`);
        params.push(updates.lifecycle_state);
      }

      if (updates.importance_score !== undefined) {
        updateFields.push(`importance_score = $${paramIndex++}`);
        params.push(updates.importance_score);
      }

      if (updates.decay_score !== undefined) {
        updateFields.push(`decay_score = $${paramIndex++}`);
        params.push(updates.decay_score);
      }

      if (updates.pinned !== undefined) {
        updateFields.push(`pinned = $${paramIndex++}`);
        params.push(updates.pinned);

        if (updates.pinned) {
          updateFields.push(`pinned_at = $${paramIndex++}`);
          params.push(new Date().toISOString());
        } else {
          updateFields.push(`pinned_at = NULL, pinned_by = NULL`);
        }
      }

      if (updateFields.length === 0) {
        return {
          ok: false,
          error: {
            type: 'validation',
            field: 'updates',
            message: 'At least one field must be provided for update',
          },
        };
      }

      // Always update updated_at
      updateFields.push(`updated_at = $${paramIndex++}`);
      params.push(new Date().toISOString());

      // Add ID and workspace_id
      params.push(id);
      params.push(workspaceId);

      const query = `
        UPDATE memories 
        SET ${updateFields.join(', ')} 
        WHERE id = $${paramIndex++} AND workspace_id = $${paramIndex++}
        RETURNING *
      `;

      const result = await this.adapter.query<Memory>(query, params);

      if (!result.ok) {
        this.logger.error('Failed to update memory lifecycle', {
          id,
          workspace_id: workspaceId,
          updates,
          error: result.error,
        });
        return result;
      }

      if (result.value.length === 0) {
        return {
          ok: false,
          error: {
            type: 'not_found',
            resource: 'memory',
            id,
          },
        };
      }

      return { ok: true, value: result.value[0] };
    } catch (error) {
      this.logger.error('Unexpected error updating memory lifecycle', {
        id,
        workspaceId,
        updates,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to update memory lifecycle',
          cause: error,
        },
      };
    }
  }

  /**
   * Delete a memory from both Postgres and Vectorize
   */
  async deleteMemory(id: string, workspaceId: string): Promise<Result<void, StorageError>> {
    if (!id || !id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'id',
          message: 'Memory ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      // First verify the memory exists and belongs to the workspace
      const memoryResult = await this.getMemory(id, workspaceId);
      if (!memoryResult.ok) {
        return memoryResult as Result<never, StorageError>;
      }

      if (memoryResult.value === null) {
        return {
          ok: false,
          error: {
            type: 'not_found',
            resource: 'memory',
            id: id,
          },
        };
      }

      this.logger.info('Deleting memory', {
        memory_id: id,
        workspace_id: workspaceId,
      });

      // Delete from Postgres (this will cascade to relationships)
      const deleteResult = await this.adapter.delete('memories', id);
      if (!deleteResult.ok) {
        this.logger.error('Failed to delete memory from Postgres', {
          memory_id: id,
          error: deleteResult.error,
        });
        return deleteResult;
      }

      // Delete from Vectorize (if embedding exists)
      // We attempt to delete even if there's no embedding, as it's a no-op
      const vectorDeleteResult = await this.vectorize.delete(id);
      if (!vectorDeleteResult.ok) {
        this.logger.warn('Failed to delete embedding from Vectorize', {
          memory_id: id,
          error: vectorDeleteResult.error,
        });
        // We don't fail the operation if Vectorize deletion fails
        // since the memory is already deleted from Postgres
      } else {
        this.logger.info('Successfully deleted memory embedding', {
          memory_id: id,
        });
      }

      return { ok: true, value: undefined };
    } catch (error) {
      this.logger.error('Unexpected error deleting memory', { id, workspaceId, error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to delete memory',
          cause: error,
        },
      };
    }
  }

  /**
   * Search memories by semantic similarity using vector search
   */
  async searchMemories(
    workspaceId: string,
    query: SearchQuery
  ): Promise<Result<SearchResult[], StorageError>> {
    // Validate workspace_id
    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    // Validate query vector
    if (!query.vector || query.vector.length === 0) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'vector',
          message: 'Query vector is required',
        },
      };
    }

    // Set default limit
    const limit = query.limit ?? 10;

    // Validate limit
    if (limit < 1 || limit > 100) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'limit',
          message: 'Limit must be between 1 and 100',
        },
      };
    }

    try {
      this.logger.info('Searching memories by vector', {
        workspace_id: workspaceId,
        limit,
        types: query.types,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      });

      // Build filter for Vectorize search
      const filter = {
        workspace_id: workspaceId,
        types: query.types,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      };

      let memoryIds: string[] = [];
      let vectorMatches: any[] = [];

      if (query.vector && query.vector.length > 0) {
        // Query Vectorize with query vector and workspace_id metadata filter
        const vectorResult = await this.vectorize.search(query.vector, limit, filter);

        if (!vectorResult.ok) {
          this.logger.error('Failed to search vectors', {
            workspace_id: workspaceId,
            error: vectorResult.error,
          });
          return vectorResult as Result<never, StorageError>;
        }

        vectorMatches = vectorResult.value;
        memoryIds = vectorMatches.map((match) => match.id);
      } else if (query.text && query.text.trim()) {
        // Text search fallback (simple LIKE for now)
        // Note: This is inefficient for large datasets but fine for MVP/local
        const text = query.text.trim();
        const sql = `
          SELECT id, 1.0 as score 
          FROM memories 
          WHERE workspace_id = $1 
          AND content LIKE $2
          ORDER BY created_at DESC
          LIMIT $3
        `;
        const params = [workspaceId, `%${text}%`, limit];

        const textResult = await this.adapter.query<{ id: string; score: number }>(sql, params);

        if (!textResult.ok) {
          return textResult as Result<never, StorageError>;
        }

        vectorMatches = textResult.value;
        memoryIds = vectorMatches.map(m => m.id);
      } else {
        // No query provided
        return { ok: true, value: [] };
      }

      // If no matches found, return empty array
      if (memoryIds.length === 0) {
        return { ok: true, value: [] };
      }

      this.logger.info('Found vector matches, fetching memory records', {
        workspace_id: workspaceId,
        match_count: memoryIds.length,
        include_archived: query.includeArchived,
      });

      // Fetch full memory records from database for matching IDs
      // Use IN to match multiple IDs and ensure workspace scoping
      // If includeArchived is true, use UNION to search both tables
      const placeholders = memoryIds.map((_, i) => `$${i + 1}`).join(', ');

      let sqlQuery: string;
      let params: any[];

      if (query.includeArchived) {
        // UNION query to search both active and archived memories
        sqlQuery = `
          SELECT *, 'active' as source FROM memories 
          WHERE id IN (${placeholders}) AND workspace_id = $${memoryIds.length + 1}
          UNION ALL
          SELECT 
            id, workspace_id, conversation_id, type, content, confidence, 
            metadata, created_at, updated_at, last_accessed_at, access_count, 
            importance_score, NULL as decay_score, NULL as effective_ttl, 
            NULL as lifecycle_state, false as pinned, NULL as pinned_by, 
            NULL as pinned_at, archived_at, expires_at, 'archived' as source
          FROM archived_memories 
          WHERE id IN (${placeholders}) AND workspace_id = $${memoryIds.length + 1}
        `;
        params = [...memoryIds, workspaceId, ...memoryIds, workspaceId];
      } else {
        // Standard query for active memories only
        sqlQuery = `SELECT * FROM memories WHERE id IN (${placeholders}) AND workspace_id = $${memoryIds.length + 1}`;
        params = [...memoryIds, workspaceId];
      }

      const memoriesResult = await this.adapter.query<Memory>(
        sqlQuery,
        params
      );

      if (!memoriesResult.ok) {
        this.logger.error('Failed to fetch memory records', {
          workspace_id: workspaceId,
          memory_ids: memoryIds,
          error: memoriesResult.error,
        });
        return memoriesResult as Result<never, StorageError>;
      }

      const memories = memoriesResult.value;

      // Create a map of memory ID to memory object for efficient lookup
      const memoryMap = new Map<string, Memory>();
      memories.forEach((memory) => {
        memoryMap.set(memory.id, memory);
      });

      // Combine memories with their similarity scores, maintaining order from vector search
      const searchResults: SearchResult[] = [];
      for (const match of vectorMatches) {
        const memory = memoryMap.get(match.id);
        if (memory) {
          searchResults.push({
            memory,
            score: match.score,
          });
        }
      }

      this.logger.info('Successfully completed semantic search', {
        workspace_id: workspaceId,
        result_count: searchResults.length,
      });

      return { ok: true, value: searchResults };
    } catch (error) {
      this.logger.error('Unexpected error searching memories', {
        workspaceId,
        query,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to search memories',
          cause: error,
        },
      };
    }
  }

  /**
   * Create a relationship between two memories with workspace boundary validation
   */
  async createRelationship(data: CreateRelationshipInput): Promise<Result<Relationship, StorageError>> {
    // Validate input
    if (!data.from_memory_id || !data.from_memory_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'from_memory_id',
          message: 'From memory ID is required',
        },
      };
    }

    if (!data.to_memory_id || !data.to_memory_id.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'to_memory_id',
          message: 'To memory ID is required',
        },
      };
    }

    if (!data.relationship_type || !data.relationship_type.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'relationship_type',
          message: 'Relationship type is required',
        },
      };
    }

    // Validate confidence range
    if (data.confidence < 0 || data.confidence > 1) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'confidence',
          message: 'Confidence must be between 0 and 1',
        },
      };
    }

    try {
      // Query both memories to verify they exist and get their workspace_ids
      const fromMemoryResult = await this.adapter.query<Memory>(
        'SELECT id, workspace_id FROM memories WHERE id = $1',
        [data.from_memory_id]
      );

      if (!fromMemoryResult.ok) {
        this.logger.error('Failed to query from_memory', {
          from_memory_id: data.from_memory_id,
          error: fromMemoryResult.error,
        });
        return fromMemoryResult as Result<never, StorageError>;
      }

      if (fromMemoryResult.value.length === 0) {
        return {
          ok: false,
          error: {
            type: 'validation',
            field: 'from_memory_id',
            message: 'From memory does not exist',
          },
        };
      }

      const toMemoryResult = await this.adapter.query<Memory>(
        'SELECT id, workspace_id FROM memories WHERE id = $1',
        [data.to_memory_id]
      );

      if (!toMemoryResult.ok) {
        this.logger.error('Failed to query to_memory', {
          to_memory_id: data.to_memory_id,
          error: toMemoryResult.error,
        });
        return toMemoryResult as Result<never, StorageError>;
      }

      if (toMemoryResult.value.length === 0) {
        return {
          ok: false,
          error: {
            type: 'validation',
            field: 'to_memory_id',
            message: 'To memory does not exist',
          },
        };
      }

      const fromMemory = fromMemoryResult.value[0];
      const toMemory = toMemoryResult.value[0];

      // Verify both memories belong to the same workspace
      if (fromMemory.workspace_id !== toMemory.workspace_id) {
        this.logger.warn('Attempted to create cross-workspace relationship', {
          from_memory_id: data.from_memory_id,
          from_workspace_id: fromMemory.workspace_id,
          to_memory_id: data.to_memory_id,
          to_workspace_id: toMemory.workspace_id,
        });

        return {
          ok: false,
          error: {
            type: 'validation',
            field: 'workspace_id',
            message: 'Memories belong to different workspaces',
          },
        };
      }

      this.logger.info('Creating relationship', {
        from_memory_id: data.from_memory_id,
        to_memory_id: data.to_memory_id,
        relationship_type: data.relationship_type,
        workspace_id: fromMemory.workspace_id,
      });

      // Create the relationship
      const result = await this.adapter.insert<Relationship>('relationships', {
        from_memory_id: data.from_memory_id.trim(),
        to_memory_id: data.to_memory_id.trim(),
        relationship_type: data.relationship_type.trim(),
        confidence: data.confidence,
      });

      if (!result.ok) {
        this.logger.error('Failed to create relationship', {
          from_memory_id: data.from_memory_id,
          to_memory_id: data.to_memory_id,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Unexpected error creating relationship', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to create relationship',
          cause: error,
        },
      };
    }
  }

  /**
   * Get all relationships for a memory with workspace scoping
   */
  async getMemoryRelationships(
    memoryId: string,
    workspaceId: string
  ): Promise<Result<Relationship[], StorageError>> {
    // Validate input
    if (!memoryId || !memoryId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'memoryId',
          message: 'Memory ID is required',
        },
      };
    }

    if (!workspaceId || !workspaceId.trim()) {
      return {
        ok: false,
        error: {
          type: 'validation',
          field: 'workspaceId',
          message: 'Workspace ID is required',
        },
      };
    }

    try {
      // Query relationships where the memory is either the source or target
      // Join with memories table to ensure workspace scoping
      // This ensures all returned relationships respect workspace boundaries
      const result = await this.adapter.query<Relationship>(
        `SELECT r.* 
         FROM relationships r
         INNER JOIN memories m_from ON r.from_memory_id = m_from.id
         INNER JOIN memories m_to ON r.to_memory_id = m_to.id
         WHERE (r.from_memory_id = $1 OR r.to_memory_id = $1)
           AND m_from.workspace_id = $2
           AND m_to.workspace_id = $2
         ORDER BY r.created_at DESC`,
        [memoryId, workspaceId]
      );

      if (!result.ok) {
        this.logger.error('Failed to get memory relationships', {
          memoryId,
          workspaceId,
          error: result.error,
        });
        return result;
      }

      this.logger.info('Retrieved memory relationships', {
        memory_id: memoryId,
        workspace_id: workspaceId,
        relationship_count: result.value.length,
      });

      return { ok: true, value: result.value };
    } catch (error) {
      this.logger.error('Unexpected error getting memory relationships', {
        memoryId,
        workspaceId,
        error,
      });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to get memory relationships',
          cause: error,
        },
      };
    }
  }

  /**
   * Execute a callback function within a database transaction
   * Automatically commits on success or rolls back on error
   */
  async transaction<T>(
    fn: (tx: Transaction) => Promise<T>
  ): Promise<Result<T, StorageError>> {
    this.logger.info('Beginning transaction');

    try {
      // Begin the transaction
      const txResult = await this.adapter.beginTransaction();

      if (!txResult.ok) {
        this.logger.error('Failed to begin transaction', {
          error: txResult.error,
        });
        return txResult as Result<never, StorageError>;
      }

      const tx = txResult.value;

      try {
        this.logger.info('Executing transaction callback');

        // Execute the callback with the transaction context
        const result = await fn(tx);

        // Commit the transaction on success
        this.logger.info('Committing transaction');
        await tx.commit();

        this.logger.info('Transaction committed successfully');
        return { ok: true, value: result };
      } catch (error) {
        // Rollback the transaction on error
        this.logger.error('Transaction callback failed, rolling back', {
          error,
        });

        try {
          await tx.rollback();
          this.logger.info('Transaction rolled back successfully');
        } catch (rollbackError) {
          this.logger.error('Failed to rollback transaction', {
            error: rollbackError,
          });
        }

        // Wrap the error in StorageError type
        return {
          ok: false,
          error: {
            type: 'database',
            message: 'Transaction failed',
            cause: error,
          },
        };
      }
    } catch (error) {
      this.logger.error('Unexpected error in transaction', { error });
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Transaction failed',
          cause: error,
        },
      };
    }
  }
}
