# Chat Capture Design

## Overview

The Chat Capture module normalizes chat conversations from different AI providers into a unified format. It uses a registry-based parser system where each provider has a dedicated parser that converts provider-specific formats to `NormalizedConversation` objects. The module supports both file imports (batch) and streaming API captures (real-time).

## Architecture

### Component Structure

```
packages/core/chat-capture/
├── src/
│   ├── index.ts              # Main ChatCapture class and exports
│   ├── types.ts              # NormalizedConversation, NormalizedMessage types
│   ├── registry.ts           # ParserRegistry for managing parsers
│   ├── parsers/
│   │   ├── base.ts           # BaseParser interface
│   │   ├── openai.ts         # ChatGPT parser
│   │   ├── anthropic.ts      # Claude parser
│   │   └── detector.ts       # Auto-detection logic
│   ├── streaming.ts          # StreamingConversationBuilder
│   ├── validator.ts          # Conversation validation logic
│   └── errors.ts             # Custom error types
├── package.json
└── tsconfig.json
```

### Key Design Decisions

1. **Parser Registry Pattern**: Parsers are registered at runtime, making it easy to add new providers without modifying core code. Apps can register custom parsers for proprietary systems.

2. **Two-Phase Processing**: Parse first (provider-specific), then validate (provider-agnostic). This separates concerns and makes validation reusable.

3. **Streaming Builder**: A separate `StreamingConversationBuilder` class handles incremental message assembly for real-time API captures, emitting complete conversations when finalized.

4. **Preserve Raw Data**: The `raw_metadata` field stores provider-specific data that doesn't map to standard fields, enabling future features without schema changes.

## Components and Interfaces

### ChatCapture

The main entry point for conversation ingestion.

```typescript
class ChatCapture {
  constructor(config: ChatCaptureConfig)
  
  // File import (batch)
  async parseFile(
    file: Buffer | string,
    provider: string,
    options?: ParseOptions
  ): Promise<Result<NormalizedConversation[], CaptureError>>
  
  // Auto-detect provider and parse
  async parseFileAuto(
    file: Buffer | string,
    options?: ParseOptions
  ): Promise<Result<NormalizedConversation[], CaptureError>>
  
  // Register custom parser
  registerParser(provider: string, parser: ConversationParser): void
  
  // Create streaming builder for real-time capture
  createStreamingBuilder(
    provider: string,
    conversationId: string
  ): Result<StreamingConversationBuilder, CaptureError>
}
```

### Configuration

```typescript
interface ChatCaptureConfig {
  maxFileSize?: number          // Default: 50MB
  maxConversationsPerFile?: number  // Default: 1000
  enableAutoDetection?: boolean // Default: true
  logger?: Logger
}

interface ParseOptions {
  strict?: boolean              // Fail on first validation error
  skipInvalid?: boolean         // Skip invalid conversations, return valid ones
}
```

### Data Models

```typescript
interface NormalizedConversation {
  id: string                    // Local UUID
  provider: string              // 'openai', 'anthropic', etc.
  external_id: string | null    // Provider's conversation ID
  title: string | null
  created_at: string            // ISO 8601
  updated_at: string            // ISO 8601
  messages: NormalizedMessage[]
  raw_metadata: Record<string, any>
}

interface NormalizedMessage {
  id: string                    // Local UUID
  role: 'user' | 'assistant' | 'system'
  content: string               // Preserved exactly as provided
  created_at: string            // ISO 8601
  raw_metadata: Record<string, any>
}
```

### Parser Interface

```typescript
interface ConversationParser {
  // Parse raw data to normalized format
  parse(data: unknown): Promise<NormalizedConversation[]>
  
  // Check if this parser can handle the data (for auto-detection)
  canParse(data: unknown): boolean
  
  // Provider identifier
  readonly provider: string
}

abstract class BaseParser implements ConversationParser {
  abstract parse(data: unknown): Promise<NormalizedConversation[]>
  abstract canParse(data: unknown): boolean
  abstract readonly provider: string
  
  // Helper methods for common parsing tasks
  protected generateId(): string
  protected normalizeTimestamp(timestamp: unknown): string
  protected normalizeRole(role: string): 'user' | 'assistant' | 'system'
}
```

### ParserRegistry

```typescript
class ParserRegistry {
  // Register a parser
  register(provider: string, parser: ConversationParser): void
  
  // Get parser by provider name
  get(provider: string): ConversationParser | undefined
  
  // Auto-detect provider from data
  detect(data: unknown): ConversationParser | undefined
  
  // List registered providers
  listProviders(): string[]
}
```

### StreamingConversationBuilder

```typescript
class StreamingConversationBuilder {
  constructor(provider: string, conversationId: string, parser: ConversationParser)
  
  // Add a message chunk (for streaming APIs)
  addChunk(chunk: StreamChunk): void
  
  // Add a complete message
  addMessage(message: Partial<NormalizedMessage>): void
  
  // Mark conversation as complete
  finalize(metadata?: Record<string, any>): NormalizedConversation
  
  // Get current state (for debugging)
  getState(): ConversationState
}

interface StreamChunk {
  messageId?: string
  role?: 'user' | 'assistant' | 'system'
  contentDelta?: string
  isComplete?: boolean
}

interface ConversationState {
  conversationId: string
  messageCount: number
  isFinalized: boolean
  currentMessage: Partial<NormalizedMessage> | null
}
```

### Validator

```typescript
class ConversationValidator {
  // Validate a single conversation
  validate(conversation: NormalizedConversation): ValidationResult
  
  // Validate multiple conversations
  validateBatch(
    conversations: NormalizedConversation[]
  ): BatchValidationResult
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

interface BatchValidationResult {
  validConversations: NormalizedConversation[]
  invalidConversations: Array<{
    conversation: NormalizedConversation
    errors: ValidationError[]
  }>
}

interface ValidationError {
  field: string
  message: string
  conversationId?: string
  messageId?: string
}
```

## Provider Parsers

### OpenAI Parser

Handles ChatGPT export format:

```typescript
class OpenAIParser extends BaseParser {
  readonly provider = 'openai'
  
  canParse(data: unknown): boolean {
    // Check for ChatGPT export structure
    return hasProperty(data, 'conversations') || 
           hasProperty(data, 'mapping')
  }
  
  async parse(data: unknown): Promise<NormalizedConversation[]> {
    // Parse ChatGPT JSON structure
    // Handle both single conversation and multi-conversation exports
    // Extract title, timestamps, messages
    // Preserve code blocks and markdown
  }
}
```

### Anthropic Parser

Handles Claude export format:

```typescript
class AnthropicParser extends BaseParser {
  readonly provider = 'anthropic'
  
  canParse(data: unknown): boolean {
    // Check for Claude export structure
    return hasProperty(data, 'uuid') && 
           hasProperty(data, 'chat_messages')
  }
  
  async parse(data: unknown): Promise<NormalizedConversation[]> {
    // Parse Claude JSON structure
    // Map Claude message roles to standard roles
    // Extract conversation metadata
    // Preserve formatting
  }
}
```

## Auto-Detection Logic

The detector tries parsers in order of specificity:

1. Check each registered parser's `canParse()` method
2. Return the first parser that returns `true`
3. If no parser matches, return error

Detection is based on structural patterns in the data (field names, nesting structure) rather than file extensions.

## Error Handling

```typescript
type CaptureError =
  | { type: 'parse_error'; provider: string; message: string; cause?: unknown }
  | { type: 'validation_error'; errors: ValidationError[] }
  | { type: 'provider_not_found'; provider: string }
  | { type: 'file_too_large'; size: number; limit: number }
  | { type: 'too_many_conversations'; count: number; limit: number }
  | { type: 'detection_failed'; message: string }

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

## Usage Examples

### File Import

```typescript
const chatCapture = new ChatCapture({
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxConversationsPerFile: 1000
})

// Explicit provider
const result = await chatCapture.parseFile(fileBuffer, 'openai')

// Auto-detect provider
const result = await chatCapture.parseFileAuto(fileBuffer)

if (!result.ok) {
  console.error('Import failed:', result.error)
  return
}

const conversations = result.value
```

### Streaming Capture

```typescript
const builderResult = chatCapture.createStreamingBuilder('openai', 'conv-123')
if (!builderResult.ok) {
  console.error('Failed to create builder:', builderResult.error)
  return
}

const builder = builderResult.value

// As streaming chunks arrive
openaiStream.on('data', (chunk) => {
  builder.addChunk({
    messageId: chunk.id,
    role: chunk.role,
    contentDelta: chunk.delta.content,
    isComplete: chunk.finish_reason !== null
  })
})

// When stream completes
openaiStream.on('end', () => {
  const conversation = builder.finalize({
    model: 'gpt-4',
    temperature: 0.7
  })
  
  // Save to storage
  await storageClient.createConversation(conversation)
})
```

### Custom Parser

```typescript
class CustomAIParser extends BaseParser {
  readonly provider = 'custom-ai'
  
  canParse(data: unknown): boolean {
    return hasProperty(data, 'custom_field')
  }
  
  async parse(data: unknown): Promise<NormalizedConversation[]> {
    // Custom parsing logic
  }
}

chatCapture.registerParser('custom-ai', new CustomAIParser())
```

## Testing Strategy

### Unit Tests

- Test each parser with real export samples from each provider
- Test validation logic with valid and invalid conversations
- Test auto-detection with various file formats
- Test streaming builder with incremental message assembly
- Test error handling for malformed data

### Integration Tests

- Test end-to-end file import with multi-conversation exports
- Test streaming capture with real API responses
- Test custom parser registration and usage
- Test file size and conversation count limits
- Test partial failure handling (skipInvalid mode)

### Test Data

- Collect real export samples from ChatGPT, Claude
- Create synthetic test cases for edge cases (empty conversations, malformed timestamps)
- Test with large files (near size limits)
- Test with deeply nested conversation structures
