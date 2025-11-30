import { ChatCapture, NormalizedConversation } from '@memorylayer/chat-capture'
import {
  MemoryExtractor,
  OpenAIProvider,
  StructuredOutputStrategy,
  ExtractionProfile,
  ExtractedMemory,
  ExtractedRelationship
} from '@memorylayer/memory-extraction'
import { DatabaseClient } from '../lib/db'
import { makerReliableExtractMemory, makerConfig } from '@memorylayer/memory-extraction'
import { OpenAIMakerProvider } from './openai-maker-provider'

export interface ImportJob {
  id: string
  workspace_id: string
  user_id: string
  status: 'processing' | 'completed' | 'failed'
  progress: {
    conversationsProcessed: number
    totalConversations: number
    memoriesExtracted: number
  }
  result?: {
    conversations: number
    memories: number
    errors: string[]
  }
  error?: string
  created_at: string
  updated_at: string
}

export interface ImportResult {
  jobId: string
  status: 'processing' | 'completed' | 'failed'
  result?: {
    conversations: number
    memories: number
    errors: string[]
  }
  error?: string
}

export interface OpenAIConfig {
  baseURL?: string
  chatModel?: string
  extractionModelPersonal?: string
  extractionModelTeam?: string
}

export class ImportService {
  private chatCapture: ChatCapture
  private db: DatabaseClient
  private jobs: Map<string, ImportJob>
  private memoryExtractor: MemoryExtractor
  private makerProvider: OpenAIMakerProvider
  private logActivity?: (workspaceId: string, userId: string, type: string, details: Record<string, any>) => Promise<void>

  constructor(
    db: DatabaseClient,
    openaiApiKey: string,
    openaiConfig: OpenAIConfig = {},
    logActivity?: (workspaceId: string, userId: string, type: string, details: Record<string, any>) => Promise<void>
  ) {
    this.db = db
    this.jobs = new Map()
    this.logActivity = logActivity

    // Initialize ChatCapture with auto-detection enabled
    this.chatCapture = new ChatCapture({
      maxFileSize: 50 * 1024 * 1024, // 50MB
      enableAutoDetection: true
    })

    // Initialize MemoryExtractor with OpenAI provider
    const openaiProvider = new OpenAIProvider({
      apiKey: openaiApiKey,
      baseURL: openaiConfig.baseURL
    })

    const strategy = new StructuredOutputStrategy()

    this.memoryExtractor = new MemoryExtractor({
      provider: openaiProvider,
      strategy: strategy,
      // Default lean extraction; facts come via profiles when needed
      memoryTypes: ['entity', 'decision'],
      minConfidence: 0.6,
      batchSize: 5
    })

    // Register 'personal_default' extraction profile
    const personalProfile: ExtractionProfile = {
      strategy: strategy,
      provider: openaiProvider,
      modelParams: {
        model: openaiConfig.extractionModelPersonal || 'anthropic/claude-haiku-4.5',
        temperature: 0.3,
        maxTokens: 2000
      },
      memoryTypes: ['entity', 'decision', 'fact'],
      minConfidence: 0.6
    }
    this.memoryExtractor.registerProfile('personal_default', personalProfile)

    // Team mode removed for hackathon - only personal workspaces supported

    // Initialize MAKER provider
    this.makerProvider = new OpenAIMakerProvider(
      openaiApiKey,
      openaiConfig.baseURL,
      openaiConfig.chatModel // Use chat model for MAKER microagents
    )
  }

  /**
   * Start an import job for a file
   */
  async importFile(
    file: Buffer,
    workspaceId: string,
    userId: string
  ): Promise<ImportResult> {
    // Generate job ID
    const jobId = crypto.randomUUID()

    // Create initial job record
    const job: ImportJob = {
      id: jobId,
      workspace_id: workspaceId,
      user_id: userId,
      status: 'processing',
      progress: {
        conversationsProcessed: 0,
        totalConversations: 0,
        memoriesExtracted: 0
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    this.jobs.set(jobId, job)

    // Process import synchronously (Cloudflare Workers limitation)
    try {
      await this.processImport(jobId, file, workspaceId)
      const completedJob = this.jobs.get(jobId)
      return {
        jobId,
        status: completedJob?.status || 'completed',
        result: completedJob?.result
      }
    } catch (error) {
      console.error('Import processing failed:', error)
      const job = this.jobs.get(jobId)
      if (job) {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : 'Unknown error'
        job.updated_at = new Date().toISOString()
      }
      return {
        jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get the status of an import job
   */
  getImportStatus(jobId: string): ImportJob | null {
    return this.jobs.get(jobId) || null
  }

  /**
   * Process the import job
   */
  private async processImport(
    jobId: string,
    file: Buffer,
    workspaceId: string
  ): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new Error('Job not found')
    }

    try {
      // Parse file using ChatCapture with auto-detection
      const parseResult = await this.chatCapture.parseFileAuto(file)

      if (!parseResult.ok) {
        const error = parseResult.error
        let errorMessage: string = error.type

        if (error.type === 'parse_error' || error.type === 'detection_failed') {
          errorMessage = error.message
        } else if (error.type === 'validation_error') {
          errorMessage = `Validation failed: ${error.errors.length} errors`
        } else if (error.type === 'file_too_large') {
          errorMessage = `File too large: ${error.size} bytes (limit: ${error.limit})`
        } else if (error.type === 'too_many_conversations') {
          errorMessage = `Too many conversations: ${error.count} (limit: ${error.limit})`
        }

        throw new Error(`Parse failed: ${errorMessage}`)
      }

      const conversations = parseResult.value
      job.progress.totalConversations = conversations.length
      job.updated_at = new Date().toISOString()

      // Store conversations in database
      const storedConversations: string[] = []
      const conversationIdMap = new Map<string, string>() // Map original ID -> database ID
      const errors: string[] = []

      for (const conversation of conversations) {
        try {
          // Store conversation via DatabaseClient with user_id for attribution
          const conversationId = await this.storeConversation(conversation, workspaceId, job.user_id)
          storedConversations.push(conversationId)
          conversationIdMap.set(conversation.id, conversationId) // Track ID mapping

          job.progress.conversationsProcessed++
          job.updated_at = new Date().toISOString()
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          errors.push(`Failed to store conversation ${conversation.id}: ${errorMsg}`)
          console.error('Failed to store conversation:', error)
        }
      }

      // Extract memories from conversations
      console.log(`Starting memory extraction for ${conversations.length} conversations`)
      const memoriesExtracted = await this.extractMemories(
        conversations,
        workspaceId,
        jobId,
        conversationIdMap // Pass the ID mapping
      )

      // Update job with final results
      job.status = 'completed'
      job.result = {
        conversations: storedConversations.length,
        memories: memoriesExtracted,
        errors
      }
      job.updated_at = new Date().toISOString()

      // Log import activity
      if (this.logActivity) {
        try {
          await this.logActivity(workspaceId, job.user_id, 'import', {
            conversation_count: storedConversations.length
          })
        } catch (error) {
          console.error('Failed to log import activity:', error)
        }
      }

      // Log extraction activity if memories were extracted
      if (memoriesExtracted > 0 && this.logActivity) {
        try {
          await this.logActivity(workspaceId, job.user_id, 'extraction', {
            memory_count: memoriesExtracted
          })
        } catch (error) {
          console.error('Failed to log extraction activity:', error)
        }
      }
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Unknown error'
      job.updated_at = new Date().toISOString()
      throw error
    }
  }

  /**
   * Store a normalized conversation in the database
   */
  private async storeConversation(
    conversation: NormalizedConversation,
    workspaceId: string,
    userId: string
  ): Promise<string> {
    // Store conversation with user_id for attribution
    const conversationResult = await this.db.query<{ id: string }>(
      `INSERT INTO conversations (workspace_id, provider, external_id, title, created_at, updated_at, raw_metadata, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        workspaceId,
        conversation.provider,
        conversation.external_id,
        conversation.title,
        conversation.created_at,
        conversation.updated_at,
        JSON.stringify(conversation.raw_metadata),
        userId
      ]
    )

    const conversationId = conversationResult[0].id

    // Store messages
    for (const message of conversation.messages) {
      await this.db.query(
        `INSERT INTO messages (conversation_id, role, content, created_at, raw_metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          conversationId,
          message.role,
          message.content,
          message.created_at,
          JSON.stringify(message.raw_metadata)
        ]
      )
    }

    return conversationId
  }

  /**
   * Extract memories from conversations using MemoryExtractor
   */
  private async extractMemories(
    conversations: NormalizedConversation[],
    workspaceId: string,
    jobId: string,
    conversationIdMap: Map<string, string>
  ): Promise<number> {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new Error('Job not found')
    }

    try {
      // Get workspace to determine which profile to use
      const workspaceResult = await this.db.query<{ type: string }>(
        'SELECT type FROM workspaces WHERE id = $1',
        [workspaceId]
      )

      if (workspaceResult.length === 0) {
        throw new Error('Workspace not found')
      }

      const workspaceType = workspaceResult[0].type
      // Always use personal profile (team mode removed for hackathon)
      const profile = 'personal_default';

      console.log(`Using extraction profile: ${profile} for workspace type: ${workspaceType}`)

      // Transform conversations to match MemoryExtractor's expected type
      // Apply trimming to keep high-value context within a token budget
      const transformedConversations = conversations.map(conv => {
        const trimmed = this.trimConversation(conv.messages);
        return {
          id: conv.id,
          messages: trimmed.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.created_at, // Map created_at to timestamp
            metadata: msg.raw_metadata
          })),
          metadata: conv.raw_metadata
        };
      });

      // Extract memories using MemoryExtractor.extractBatch()
      const extractionResult = await this.memoryExtractor.extractBatch(
        transformedConversations,
        workspaceId,
        { profile }
      )

      if (!extractionResult.ok) {
        console.error('Memory extraction failed:', extractionResult.error)
        const errorMsg = 'message' in extractionResult.error
          ? extractionResult.error.message
          : extractionResult.error.type
        throw new Error(`Memory extraction failed: ${errorMsg}`)
      }

      const batchResult = extractionResult.value
      console.log(`Extraction complete: ${batchResult.totalMemories} memories, ${batchResult.totalRelationships} relationships`)

      // Collect all memories and relationships from successful extractions
      const allMemories: ExtractedMemory[] = []
      const allRelationships: ExtractedRelationship[] = []

      for (const result of batchResult.results) {
        if (result.status === 'success' || result.status === 'partial') {
          const mappedConversationId = conversationIdMap.get(result.conversationId)
          for (const memory of result.memories) {
            if (memory.conversation_id && conversationIdMap.has(memory.conversation_id)) {
              memory.conversation_id = conversationIdMap.get(memory.conversation_id)!
            } else if (!memory.conversation_id && mappedConversationId) {
              memory.conversation_id = mappedConversationId
            }
          }
          allMemories.push(...result.memories)
          allRelationships.push(...result.relationships)
        }
      }

      // Store memories via DatabaseClient
      let memoriesStored = 0
      for (const memory of allMemories) {
        try {
          // Remap conversation_id from original to database ID
          if (memory.conversation_id && conversationIdMap.has(memory.conversation_id)) {
            memory.conversation_id = conversationIdMap.get(memory.conversation_id)!
          }

          await this.storeMemory(memory, workspaceId)
          memoriesStored++

          // Update job progress
          job.progress.memoriesExtracted = memoriesStored
          job.updated_at = new Date().toISOString()
        } catch (error) {
          console.error('Failed to store memory:', error)
          // Continue with other memories
        }
      }

      // Store relationships
      for (const relationship of allRelationships) {
        try {
          await this.storeRelationship(relationship, workspaceId)
        } catch (error) {
          console.error('Failed to store relationship:', error)
          // Continue with other relationships
        }
      }

      console.log(`Stored ${memoriesStored} memories and ${allRelationships.length} relationships`)

      // --- MAKER RELIABILITY LAYER ---
      if (makerConfig.enabled) {
        console.log('[MAKER] Starting reliable extraction for high-value sessions...');
        let makerMemoriesStored = 0;

        for (const conversation of conversations) {
          try {
            // Reconstruct conversation text for MAKER
            const sourceText = conversation.messages
              .map(m => `${m.role.toUpperCase()}: ${m.content}`)
              .join('\n\n');

            // Run MAKER extraction (parallel microagents + voting)
            const makerResult = await makerReliableExtractMemory(sourceText, this.makerProvider);

            if (makerResult) {
              // Store MAKER-verified memory
              const conversationId = conversationIdMap.get(conversation.id);

              const memory: ExtractedMemory = {
                id: crypto.randomUUID(),
                type: 'fact.session',
                content: makerResult.summary,
                confidence: 0.95, // High confidence due to consensus
                workspace_id: workspaceId,
                conversation_id: conversationId!,
                source_message_ids: conversation.messages.map(m => m.id),
                created_at: new Date().toISOString(),
                metadata: {
                  maker_verified: true,
                  decisions: makerResult.decisions,
                  todos: makerResult.todos,
                  extraction_method: 'maker_consensus'
                }
              };

              await this.storeMemory(memory, workspaceId);
              makerMemoriesStored++;
            }
          } catch (error) {
            console.error('[MAKER] Extraction failed for conversation:', error);
            // Continue - don't block import on MAKER failure
          }
        }
        console.log(`[MAKER] Successfully stored ${makerMemoriesStored} verified memories`);
        memoriesStored += makerMemoriesStored;
      }
      // -------------------------------

      return memoriesStored
    } catch (error) {
      console.error('Memory extraction error:', error)
      // Don't fail the entire import if memory extraction fails
      return 0
    }
  }

  /**
   * Store an extracted memory in the database
   */
  private async storeMemory(memory: ExtractedMemory, workspaceId: string): Promise<void> {
    const createdAt = memory.created_at || new Date().toISOString()
    let confidence = Number(memory.confidence)
    if (!Number.isFinite(confidence)) {
      confidence = 0.5
    } else {
      confidence = Math.min(Math.max(confidence, 0), 1)
    }
    const conversationId = memory.conversation_id ?? null
    const finalWorkspaceId = memory.workspace_id || workspaceId

    await this.db.query(
      `INSERT INTO memories (id, workspace_id, conversation_id, type, content, confidence, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        memory.id,
        finalWorkspaceId,
        conversationId,
        memory.type,
        memory.content,
        confidence,
        JSON.stringify(memory.metadata),
        createdAt
      ]
    )
  }

  /**
   * Store an extracted relationship in the database
   */
  private async storeRelationship(relationship: ExtractedRelationship, workspaceId: string): Promise<void> {
    const createdAt = relationship.created_at || new Date().toISOString()
    let confidence = Number(relationship.confidence)
    if (!Number.isFinite(confidence)) {
      confidence = 0.5
    } else {
      confidence = Math.min(Math.max(confidence, 0), 1)
    }
    const relationshipWithWorkspace = relationship as ExtractedRelationship & { workspace_id?: string }
    const finalWorkspaceId = relationshipWithWorkspace.workspace_id || workspaceId

    await this.db.query(
      `INSERT INTO relationships (id, workspace_id, from_memory_id, to_memory_id, relationship_type, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        relationship.id,
        finalWorkspaceId,
        relationship.from_memory_id,
        relationship.to_memory_id,
        relationship.relationship_type,
        confidence,
        createdAt
      ]
    )
  }

  /**
   * Trim a conversation to prioritize key context within ~4k tokens.
   * Heuristics:
   *  - Always keep the first user/human message (task/intent).
   *  - Always keep the last assistant message (final advice/summary).
   *  - Keep messages with decision/action/summary keywords.
   *  - Stop when approx. 4k tokens reached; if needed, truncate the last assistant.
   */
  private trimConversation(messages: NormalizedConversation['messages']): NormalizedConversation['messages'] {
    const TOKEN_CAP = 4000;
    const keyword = /(decid|decision|plan|should|fix|action|todo|summary|tl;?dr|next steps|key takeaways)/i;

    const isUser = (role: string) => ['user', 'human'].includes(role.toLowerCase());
    const isAssistant = (role: string) => ['assistant', 'ai', 'model'].includes(role.toLowerCase());

    const firstUser = messages.find(m => isUser(m.role));
    const lastAssistant = [...messages].reverse().find(m => isAssistant(m.role));
    const keywordMsgs = messages.filter(m => keyword.test(m.content));

    const selected: typeof messages = [];
    const seen = new Set<string>();
    const addMsg = (m?: (typeof messages)[number]) => {
      if (!m || seen.has(m.id)) return;
      seen.add(m.id);
      selected.push(m);
    };

    addMsg(firstUser);
    keywordMsgs.forEach(addMsg);
    addMsg(lastAssistant);

    // Preserve original order of selected messages
    const ordered = messages.filter(m => seen.has(m.id));

    const estTokens = (text: string) => Math.ceil(text.length / 4); // rough approximation
    let totalTokens = 0;
    const trimmed: typeof messages = [];

    for (const msg of ordered) {
      const content = isAssistant(msg.role)
        ? this.trimAssistantContent(msg.content)
        : msg.content;
      const msgTokens = estTokens(content);
      if (totalTokens + msgTokens <= TOKEN_CAP) {
        trimmed.push({ ...msg, content });
        totalTokens += msgTokens;
      } else {
        const isLastAssistant = lastAssistant && msg.id === lastAssistant.id;
        const remaining = TOKEN_CAP - totalTokens;
        if (isLastAssistant && remaining > 0) {
          const maxChars = remaining * 4;
          trimmed.push({
            ...msg,
            content: content.slice(0, maxChars)
          });
          totalTokens = TOKEN_CAP;
        }
        break;
      }
    }

    // Fallback: if nothing was selected, keep the first message truncated to fit
    if (trimmed.length === 0 && messages.length > 0) {
      const first = messages[0];
      const maxChars = TOKEN_CAP * 4;
      trimmed.push({ ...first, content: first.content.slice(0, maxChars) });
    }

    return trimmed;
  }

  /**
   * Trim inside a long assistant message to keep key sections (fixes, results, summary, actions).
   * This is a lightweight heuristic: keep paragraphs with keywords and bullets/numbered lists.
   */
  private trimAssistantContent(content: string): string {
    const KEEP_KEYWORD = /(fix|expected results|tl;?dr|tldr|do this|action items|next steps|summary|key takeaways)/i;
    const paragraphs = content.split(/\n\s*\n/);
    const kept: string[] = [];

    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const isBullet = /^[-*]\s/.test(trimmed) || /^\d+[\).\s]/.test(trimmed);
      if (KEEP_KEYWORD.test(trimmed) || isBullet) {
        kept.push(trimmed);
      }
    }

    if (kept.length === 0) {
      // No obvious summary sections—return original unless it's extremely long
      return content.length > 1200 ? content.slice(0, 1200) : content;
    }

    // Limit to a reasonable size (~4k tokens -> ~16k chars)
    const joined = kept.join('\n\n');
    return joined.slice(0, 16000);
  }
}
