# Memory Extraction Design

## Overview

The Memory Extraction module uses LLM-based analysis to extract structured memories (entities, facts, decisions) from conversations. It provides a configurable extraction pipeline with support for batch processing, incremental extraction, and custom memory types. The module outputs memory objects ready for storage, with confidence scores, relationships, and source tracking.

## Architecture

### Component Structure

```
packages/core/memory-extraction/
├── src/
│   ├── index.ts              # Main MemoryExtractor class
│   ├── types.ts              # ExtractedMemory, ExtractionResult types
│   ├── strategies/
│   │   ├── base.ts           # BaseStrategy interface
│   │   ├── prompt-based.ts   # Prompt-based extraction
│   │   ├── structured.ts     # Structured output extraction
│   │   └── function-call.ts  # Function calling extraction
│   ├── providers/
│   │   ├── base.ts           # LLMProvider interface
│   │   ├── openai.ts         # OpenAI provider
│   │   └── anthropic.ts      # Anthropic provider
│   ├── deduplicator.ts       # Memory deduplication logic
│   ├── validator.ts          # Memory validation
│   ├── incremental.ts        # IncrementalExtractor for streaming
│   ├── profiles.ts           # Extraction profile management
│   └── errors.ts             # Custom error types
├── package.json
└── tsconfig.json
```

### Key Design Decisions

1. **Strategy Pattern**: Different extraction strategies (prompt-based, structured output, function calling) implement a common interface, making it easy to switch or add new approaches.

2. **Provider Abstraction**: LLM providers (OpenAI, Anthropic) are abstracted behind a common interface, allowing the same extraction logic to work with different models.

3. **Stable Memory IDs**: Memories are assigned deterministic IDs based on content hash + type, enabling consistent updates across incremental extractions.

4. **Profile-Based Configuration**: Named profiles (e.g., "personal_default", "team_default") bundle all extraction settings, making it easy for apps to configure behavior.

5. **Workspace-Scoped**: All extraction operations require workspace_id, ensuring memories are properly scoped from the start.

## Components and Interfaces

### MemoryExtractor

The main entry point for memory extraction.

```typescript
class MemoryExtractor {
  constructor(config: MemoryExtractorConfig)
  
  // Extract from single conversation
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<ExtractionResult, ExtractionError>>
  
  // Extract from multiple conversations (batch)
  async extractBatch(
    conversations: NormalizedConversation[],
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<BatchExtractionResult, ExtractionError>>
  
  // Create incremental extractor for streaming
  createIncrementalExtractor(
    conversationId: string,
    workspaceId: string,
    options?: ExtractionOptions
  ): IncrementalExtractor
  
  // Register custom memory type
  registerMemoryType(type: string, config: MemoryTypeConfig): void
  
  // Register extraction profile
  registerProfile(name: string, profile: ExtractionProfile): void
}
```

### Configuration

```typescript
interface MemoryExtractorConfig {
  provider: LLMProvider
  strategy: ExtractionStrategy
  memoryTypes?: string[]          // Default: ['entity', 'fact', 'decision']
  minConfidence?: number          // Default: 0.5
  batchSize?: number              // Default: 10
  retryConfig?: RetryConfig
  logger?: Logger
}

interface ExtractionOptions {
  profile?: string                // Use named profile
  memoryTypes?: string[]          // Override config
  minConfidence?: number          // Override config
  includeRelationships?: boolean  // Default: true
}

interface ExtractionProfile {
  strategy: ExtractionStrategy
  provider: LLMProvider
  modelParams: ModelParams
  memoryTypes: string[]
  minConfidence: number
}

interface ModelParams {
  model: string
  temperature: number
  maxTokens: number
}

interface RetryConfig {
  maxRetries: number
  initialDelay: number
  maxDelay: number
  backoffMultiplier: number
}
```

### Data Models

**Note**: `ExtractedMemory` and `ExtractedRelationship` are designed to map 1:1 onto the Storage Layer's `memories` and `relationships` tables, enabling direct persistence without transformation.

```typescript
interface ExtractedMemory {
  id: string                      // Deterministic ID (hash-based)
  type: string                    // 'entity', 'fact', 'decision', or custom
  content: string
  confidence: number              // 0-1
  workspace_id: string
  conversation_id: string
  source_message_ids: string[]
  metadata: Record<string, any>   // Type-specific attributes
  created_at: string              // ISO 8601
}

interface ExtractedRelationship {
  id: string
  from_memory_id: string
  to_memory_id: string
  relationship_type: string
  confidence: number
  created_at: string
}
```

**Workspace Scoping for Relationships**: Relationships don't store `workspace_id` directly. Instead, workspace scoping is enforced via the `workspace_id` on the connected memories. Validation ensures both `from_memory_id` and `to_memory_id` belong to the same workspace.

interface ExtractionResult {
  memories: ExtractedMemory[]
  relationships: ExtractedRelationship[]
  conversationId: string
  status: 'success' | 'partial' | 'failed'
  errors?: ExtractionError[]
}

interface BatchExtractionResult {
  results: ExtractionResult[]
  totalMemories: number
  totalRelationships: number
  successCount: number
  failureCount: number
}
```

### Extraction Strategy Interface

```typescript
interface ExtractionStrategy {
  // Extract memories from conversation
  extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult>
  
  // Extract from message chunk (for incremental)
  extractIncremental(
    messages: NormalizedMessage[],
    context: IncrementalContext
  ): Promise<RawExtractionResult>
  
  readonly name: string
}

interface StrategyConfig {
  memoryTypes: string[]
  provider: LLMProvider
  modelParams: ModelParams
}

interface RawExtractionResult {
  memories: Partial<ExtractedMemory>[]
  relationships: Partial<ExtractedRelationship>[]
}
```

### LLM Provider Interface

```typescript
interface LLMProvider {
  // Call LLM with prompt
  complete(
    prompt: string,
    params: ModelParams
  ): Promise<string>
  
  // Call LLM with structured output
  completeStructured<T>(
    prompt: string,
    schema: JSONSchema,
    params: ModelParams
  ): Promise<T>
  
  // Call LLM with function calling
  completeWithFunctions(
    prompt: string,
    functions: FunctionDefinition[],
    params: ModelParams
  ): Promise<FunctionCallResult>
  
  readonly name: string
}
```

### Deduplicator

```typescript
class MemoryDeduplicator {
  // Deduplicate memories within a batch
  deduplicate(memories: ExtractedMemory[]): ExtractedMemory[]
  
  // Generate stable ID for memory
  generateMemoryId(memory: Partial<ExtractedMemory>): string
  
  // Check if two memories are duplicates
  areDuplicates(m1: ExtractedMemory, m2: ExtractedMemory): boolean
  
  // Merge duplicate memories
  merge(memories: ExtractedMemory[]): ExtractedMemory
}
```

Deduplication strategy:
- Generate stable ID from: `hash(type + normalized_content + workspace_id)`
- Normalize content: lowercase, trim, remove extra whitespace
- For entities: also consider entity type and name
- When merging: keep highest confidence, merge source_message_ids, merge metadata

### Validator

```typescript
class MemoryValidator {
  // Validate single memory
  validate(memory: ExtractedMemory): ValidationResult
  
  // Validate batch
  validateBatch(memories: ExtractedMemory[]): BatchValidationResult
  
  // Validate relationships
  validateRelationships(
    relationships: ExtractedRelationship[],
    memories: ExtractedMemory[]
  ): ValidationResult
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

interface ValidationError {
  field: string
  message: string
  memoryId?: string
}
```

Validation rules:
- Required fields: type, content, confidence, workspace_id, conversation_id
- Confidence must be 0-1
- Content must not be empty or trivial (< 3 chars)
- Relationships must reference existing memories
- Relationships must connect memories in same workspace

### IncrementalExtractor

**Note**: `IncrementalExtractor` must use `MemoryDeduplicator.generateMemoryId()` for all new and updated memories to ensure stable IDs across incremental runs and consistency with batch extraction.

```typescript
class IncrementalExtractor {
  constructor(
    conversationId: string,
    workspaceId: string,
    strategy: ExtractionStrategy,
    config: MemoryExtractorConfig
  )
  
  // Add new messages and extract
  async addMessages(
    messages: NormalizedMessage[]
  ): Promise<Result<IncrementalResult, ExtractionError>>
  
  // Finalize extraction
  async finalize(): Promise<Result<ExtractionResult, ExtractionError>>
  
  // Get current state
  getState(): IncrementalState
  
  // Event emitter for new memories
  on(event: 'memory', handler: (memory: ExtractedMemory) => void): void
  on(event: 'relationship', handler: (rel: ExtractedRelationship) => void): void
}

interface IncrementalResult {
  newMemories: ExtractedMemory[]
  updatedMemories: ExtractedMemory[]
  newRelationships: ExtractedRelationship[]
}

interface IncrementalState {
  conversationId: string
  workspaceId: string
  messageCount: number
  memoryCount: number
  isFinalized: boolean
}

interface IncrementalContext {
  conversationId: string
  workspaceId: string
  existingMemories: ExtractedMemory[]
  messageHistory: NormalizedMessage[]
}
```

## Extraction Strategies

### Prompt-Based Strategy

Uses a carefully crafted prompt to extract memories in a single LLM call.

```typescript
class PromptBasedStrategy implements ExtractionStrategy {
  readonly name = 'prompt-based'
  
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult> {
    const prompt = this.buildPrompt(conversation, config.memoryTypes)
    const response = await config.provider.complete(prompt, config.modelParams)
    return this.parseResponse(response, conversation.id, workspaceId)
  }
  
  private buildPrompt(
    conversation: NormalizedConversation,
    memoryTypes: string[]
  ): string {
    // Build prompt with conversation context and memory type instructions
  }
  
  private parseResponse(
    response: string,
    conversationId: string,
    workspaceId: string
  ): RawExtractionResult {
    // Parse LLM response (expected JSON format)
  }
}
```

### Structured Output Strategy

Uses LLM structured output (OpenAI's response_format or Anthropic's tool use) for reliable extraction.

```typescript
class StructuredOutputStrategy implements ExtractionStrategy {
  readonly name = 'structured-output'
  
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult> {
    const prompt = this.buildPrompt(conversation, config.memoryTypes)
    const schema = this.buildSchema(config.memoryTypes)
    const result = await config.provider.completeStructured(
      prompt,
      schema,
      config.modelParams
    )
    return this.transformResult(result, conversation.id, workspaceId)
  }
}
```

### Function Calling Strategy

Uses OpenAI function calling or Anthropic tool use for extraction.

```typescript
class FunctionCallStrategy implements ExtractionStrategy {
  readonly name = 'function-calling'
  
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    config: StrategyConfig
  ): Promise<RawExtractionResult> {
    const prompt = this.buildPrompt(conversation)
    const functions = this.buildFunctions(config.memoryTypes)
    const result = await config.provider.completeWithFunctions(
      prompt,
      functions,
      config.modelParams
    )
    return this.transformFunctionCalls(result, conversation.id, workspaceId)
  }
}
```

## Memory Type Configuration

```typescript
interface MemoryTypeConfig {
  type: string
  extractionPrompt: string
  schema?: JSONSchema
  validator?: (memory: ExtractedMemory) => boolean
}

// Default memory types
const DEFAULT_MEMORY_TYPES: Record<string, MemoryTypeConfig> = {
  entity: {
    type: 'entity',
    extractionPrompt: 'Extract people, organizations, places, and concepts...',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        entityType: { type: 'string', enum: ['person', 'organization', 'place', 'concept'] },
        description: { type: 'string' }
      }
    }
  },
  fact: {
    type: 'fact',
    extractionPrompt: 'Extract factual statements and knowledge...',
    schema: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        category: { type: 'string' }
      }
    }
  },
  decision: {
    type: 'decision',
    extractionPrompt: 'Extract decisions, choices, and conclusions...',
    schema: {
      type: 'object',
      properties: {
        decision: { type: 'string' },
        rationale: { type: 'string' },
        alternatives: { type: 'array', items: { type: 'string' } }
      }
    }
  }
}
```

## Error Handling

```typescript
type ExtractionError =
  | { type: 'llm_error'; provider: string; message: string; cause?: unknown }
  | { type: 'rate_limit'; retryAfter: number }
  | { type: 'validation_error'; errors: ValidationError[] }
  | { type: 'configuration_error'; message: string }
  | { type: 'parse_error'; message: string; rawResponse?: string }

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

## Retry Logic

```typescript
class RetryHandler {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    let attempt = 0
    let delay = config.initialDelay
    
    while (attempt < config.maxRetries) {
      try {
        return await fn()
      } catch (error) {
        if (this.isRateLimitError(error)) {
          // Wait for rate limit reset
          await this.sleep(this.getRateLimitDelay(error))
        } else if (attempt < config.maxRetries - 1) {
          // Exponential backoff
          await this.sleep(delay)
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay)
        } else {
          throw error
        }
        attempt++
      }
    }
  }
}
```

## Usage Examples

### Basic Extraction

```typescript
const extractor = new MemoryExtractor({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  strategy: new StructuredOutputStrategy(),
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.6
})

const result = await extractor.extract(conversation, workspaceId)

if (!result.ok) {
  console.error('Extraction failed:', result.error)
  return
}

const { memories, relationships } = result.value
```

### Batch Extraction

```typescript
const batchResult = await extractor.extractBatch(conversations, workspaceId, {
  profile: 'personal_default'
})

if (!batchResult.ok) {
  console.error('Batch extraction failed:', batchResult.error)
  return
}

console.log(`Extracted ${batchResult.value.totalMemories} memories`)
console.log(`Success rate: ${batchResult.value.successCount}/${conversations.length}`)
```

### Incremental Extraction

```typescript
const incrementalExtractor = extractor.createIncrementalExtractor(
  conversationId,
  workspaceId
)

// Listen for new memories
incrementalExtractor.on('memory', (memory) => {
  console.log('New memory extracted:', memory)
  // Save to storage
})

// As messages arrive
await incrementalExtractor.addMessages(newMessages)

// When conversation ends
const finalResult = await incrementalExtractor.finalize()
```

### Custom Memory Type

```typescript
extractor.registerMemoryType('task', {
  type: 'task',
  extractionPrompt: 'Extract action items and tasks mentioned in the conversation...',
  schema: {
    type: 'object',
    properties: {
      task: { type: 'string' },
      assignee: { type: 'string' },
      dueDate: { type: 'string' },
      status: { type: 'string', enum: ['todo', 'in_progress', 'done'] }
    }
  },
  validator: (memory) => memory.metadata.task && memory.metadata.task.length > 5
})
```

## MVP Scope

For initial implementation (hackathon/v1), focus on:

1. **Single Strategy**: `StructuredOutputStrategy` (most reliable)
2. **Single Provider**: `OpenAIProvider` (widely available)
3. **Core Memory Types**: entity, fact, decision
4. **Batch Extraction**: Full implementation
5. **Basic Incremental**: Simple implementation that accumulates messages and calls extract

Future expansion (post-MVP):
- Additional strategies (prompt-based, function calling)
- Additional providers (Anthropic)
- Custom memory types
- Advanced incremental extraction with true streaming
- Extraction profiles

The design supports all features, but MVP focuses on demonstrating the skeleton's reusability.

## Testing Strategy

### Unit Tests

- Test each extraction strategy with mock LLM responses
- Test deduplication logic with various memory combinations
- Test validation with valid and invalid memories
- Test retry logic with simulated failures
- Test memory ID generation for stability

### Integration Tests

- Test with real LLM providers (OpenAI, Anthropic)
- Test batch extraction with multiple conversations
- Test incremental extraction with streaming messages
- Test custom memory type registration and extraction
- Test profile-based configuration
- Test error handling and partial results

### Test Data

- Use real conversation samples for extraction testing
- Create synthetic conversations with known entities/facts/decisions
- Test edge cases (empty conversations, very long conversations)
- Test deduplication with intentionally duplicate memories
