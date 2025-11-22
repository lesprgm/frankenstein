# Context Engine Design

## Overview

The Context Engine provides semantic search over memories and formats relevant context for AI prompts. It combines vector search (via Storage Layer), ranking, filtering, and template-based formatting to inject the right memories into conversations. The module is workspace-scoped and uses the Storage Layer for all data access.

## Architecture

### Component Structure

```
packages/core/context-engine/
├── src/
│   ├── index.ts              # Main ContextEngine class
│   ├── types.ts              # SearchResult, ContextResult types
│   ├── embeddings/
│   │   ├── base.ts           # EmbeddingProvider interface
│   │   ├── openai.ts         # OpenAI embeddings
│   │   └── cache.ts          # Embedding cache
│   ├── ranker.ts             # Result ranking logic
│   ├── formatter.ts          # Context formatting
│   ├── templates.ts          # Context templates
│   ├── tokenizer.ts          # Token counting utilities
│   └── errors.ts             # Custom error types
├── package.json
└── tsconfig.json
```

### Key Design Decisions

1. **Storage Layer Dependency**: All memory and relationship lookups go through the Storage Layer. The Context Engine never talks directly to databases.

2. **Workspace-First API**: All search methods require `workspace_id` as a parameter, enforcing isolation at the API level.

3. **Embedding Cache**: Query embeddings are cached by `(query_text, embedding_model)` to avoid redundant API calls.

4. **Token-Aware Formatting**: Uses actual tokenizers (tiktoken for OpenAI) when available, falls back to character approximation otherwise.

5. **Template-Based Formatting**: Context templates are configurable and reusable, making it easy to adapt formatting for different use cases.

## Components and Interfaces

### ContextEngine

The main entry point for context operations.

```typescript
class ContextEngine {
  constructor(config: ContextEngineConfig)
  
  // Search memories by text query
  async search(
    query: string,
    workspaceId: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], ContextError>>
  
  // Search memories by pre-computed vector
  async searchByVector(
    vector: number[],
    workspaceId: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], ContextError>>
  
  // Build formatted context from query
  async buildContext(
    query: string,
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextResult, ContextError>>
  
  // Build formatted context from vector
  async buildContextByVector(
    vector: number[],
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextResult, ContextError>>
  
  // Preview context without finalizing
  async previewContext(
    query: string,
    workspaceId: string,
    options?: ContextOptions
  ): Promise<Result<ContextPreview, ContextError>>
  
  // Register custom context template
  registerTemplate(name: string, template: ContextTemplate): void
  
  // Register custom ranking function
  registerRanker(name: string, ranker: RankingFunction): void
}
```

### Configuration

```typescript
interface ContextEngineConfig {
  storageClient: StorageClient      // Required: Storage Layer client
  embeddingProvider: EmbeddingProvider
  expectedEmbeddingDimensions?: number  // Validate against provider dimensions
  defaultTemplate?: string          // Default: 'chat'
  defaultTokenBudget?: number       // Default: 2000
  cacheConfig?: CacheConfig
  logger?: Logger
}

// Note: Constructor validates embeddingProvider.dimensions matches expectedEmbeddingDimensions if provided

interface SearchOptions {
  limit?: number                    // Default: 10
  memoryTypes?: string[]            // Filter by type
  dateFrom?: Date                   // Filter by date range
  dateTo?: Date
  minConfidence?: number            // Filter by confidence
  conversationId?: string           // Filter by conversation
  includeRelationships?: boolean    // Default: false
  relationshipDepth?: number        // Default: 1
}

interface ContextOptions extends SearchOptions {
  template?: string                 // Template name or custom template
  tokenBudget?: number              // Max tokens for context
  ranker?: string | RankingFunction // Ranking strategy
  includeMetadata?: boolean         // Include memory metadata in output
}

interface CacheConfig {
  maxSize?: number                  // Max cached embeddings
  ttl?: number                      // Time to live in seconds
}
```

### Data Models

```typescript
interface SearchResult {
  memory: Memory                    // From Storage Layer
  score: number                     // Similarity score (0-1)
  rank?: number                     // After ranking
  relationships?: RelatedMemory[]   // If includeRelationships=true
}

interface RelatedMemory {
  memory: Memory
  relationship: Relationship
  depth: number                     // Relationship depth from original
}

interface ContextResult {
  context: string                   // Formatted context string
  tokenCount: number                // Actual or estimated tokens
  memories: SearchResult[]          // Included memories
  truncated: boolean                // True if budget was exceeded
  template: string                  // Template used
}

interface ContextPreview extends ContextResult {
  memoryIds: string[]               // IDs of included memories
  rankingScores: Record<string, number>  // Memory ID -> rank score
  budgetUsed: number                // Percentage of budget used
}
```

### Embedding Provider Interface

```typescript
interface EmbeddingProvider {
  // Generate embedding for text
  embed(text: string): Promise<number[]>
  
  // Generate embeddings for multiple texts (batch)
  embedBatch(texts: string[]): Promise<number[][]>
  
  // Get embedding dimensions
  readonly dimensions: number
  
  // Get model name
  readonly model: string
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(config: { apiKey: string; model?: string })
  
  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
  
  readonly dimensions: number       // 1536 for text-embedding-3-small
  readonly model: string
}
```

### Embedding Cache

```typescript
class EmbeddingCache {
  constructor(config: CacheConfig)
  
  // Get cached embedding
  get(key: string): number[] | undefined
  
  // Set cached embedding
  set(key: string, embedding: number[]): void
  
  // Generate cache key
  generateKey(text: string, model: string): string
  
  // Clear cache
  clear(): void
}
```

Cache key format: `${model}:${hash(text)}`

### Ranker

```typescript
type RankingFunction = (results: SearchResult[], options: RankingOptions) => SearchResult[]

interface RankingOptions {
  recencyWeight?: number            // Weight for recent memories (0-1)
  confidenceWeight?: number         // Weight for high confidence (0-1)
  similarityWeight?: number         // Weight for similarity score (0-1)
}

class MemoryRanker {
  // Default ranking: combines similarity, recency, confidence
  static defaultRanking(
    results: SearchResult[],
    options: RankingOptions
  ): SearchResult[]
  
  // Rank by similarity only
  static bySimilarity(results: SearchResult[]): SearchResult[]
  
  // Rank by recency only
  static byRecency(results: SearchResult[]): SearchResult[]
  
  // Rank by confidence only
  static byConfidence(results: SearchResult[]): SearchResult[]
  
  // Custom ranking function
  static custom(
    results: SearchResult[],
    scoreFn: (result: SearchResult) => number
  ): SearchResult[]
}
```

Default ranking formula:
```
rank_score = (similarity * similarityWeight) + 
             (recency_score * recencyWeight) + 
             (confidence * confidenceWeight)

recency_score = 1 / (1 + days_since_creation)
```

### Formatter

```typescript
class ContextFormatter {
  constructor(tokenizer: Tokenizer)
  
  // Format memories using template
  format(
    memories: SearchResult[],
    template: ContextTemplate,
    tokenBudget: number
  ): ContextResult
  
  // Estimate tokens for text
  estimateTokens(text: string): number
  
  // Truncate to fit budget
  truncateToFit(
    memories: SearchResult[],
    template: ContextTemplate,
    tokenBudget: number
  ): SearchResult[]
}
```

### Context Templates

```typescript
interface ContextTemplate {
  name: string
  header?: string                   // Template header
  memoryFormat: string              // Format for each memory
  separator: string                 // Between memories
  footer?: string                   // Template footer
  includeMetadata: boolean          // Include type, confidence, timestamp
}

// Default templates
const DEFAULT_TEMPLATES: Record<string, ContextTemplate> = {
  chat: {
    name: 'chat',
    header: 'Relevant context from past conversations:\n\n',
    memoryFormat: '- {{content}}',
    separator: '\n',
    footer: '\n',
    includeMetadata: false
  },
  detailed: {
    name: 'detailed',
    header: 'Relevant memories:\n\n',
    memoryFormat: '[{{type}}] {{content}} (confidence: {{confidence}}, {{timestamp}})',
    separator: '\n\n',
    footer: '\n',
    includeMetadata: true
  },
  summary: {
    name: 'summary',
    header: 'Key information:\n',
    memoryFormat: '{{content}}',
    separator: ' | ',
    footer: '',
    includeMetadata: false
  }
}
```

Template variables:
- `{{content}}`: Memory content
- `{{type}}`: Memory type
- `{{confidence}}`: Confidence score
- `{{timestamp}}`: Created at timestamp
- `{{score}}`: Similarity score

### Tokenizer

```typescript
interface Tokenizer {
  // Count tokens in text
  count(text: string): number
  
  // Encode text to tokens
  encode(text: string): number[]
  
  // Decode tokens to text
  decode(tokens: number[]): string
}

class TiktokenTokenizer implements Tokenizer {
  constructor(model: string)        // e.g., 'gpt-4', 'gpt-3.5-turbo'
  
  count(text: string): number
  encode(text: string): number[]
  decode(tokens: number[]): string
}

class CharacterTokenizer implements Tokenizer {
  // Fallback: approximates 1 token ≈ 4 characters
  count(text: string): number {
    return Math.ceil(text.length / 4)
  }
  
  encode(text: string): number[] {
    return Array.from(text).map(c => c.charCodeAt(0))
  }
  
  decode(tokens: number[]): string {
    return String.fromCharCode(...tokens)
  }
}
```

## Implementation Notes

### Internal Consolidation

To avoid code duplication, the implementation should:

- `search(text, ...)` → generate embedding → call private `searchInternal(vector, ...)`
- `searchByVector(vector, ...)` → directly call private `searchInternal(vector, ...)`
- Same pattern for `buildContext` vs `buildContextByVector`

This ensures consistent behavior regardless of query type.

### Graceful Degradation

Callers of `buildContext` are expected to fall back to empty context if `Result.ok === false`, satisfying the "don't crash, degrade gracefully" requirement. Example:

```typescript
const contextResult = await contextEngine.buildContext(query, workspaceId)
if (!contextResult.ok) {
  // Degrade gracefully: proceed with empty context
  return { context: '', memories: [] }
}
```

## Search Flow

1. **Query → Embedding**:
   - Check embedding cache for query
   - If not cached, call embedding provider
   - Cache result for future use

2. **Vector Search**:
   - Call `storageClient.searchMemories(workspaceId, query)`
   - Apply filters (type, date, confidence, conversation)
   - Get results with similarity scores

3. **Relationship Expansion** (if enabled):
   - For each result, call `storageClient.getMemoryRelationships(memoryId, workspaceId)`
   - Follow relationships up to configured depth
   - Deduplicate memories

4. **Ranking**:
   - Apply ranking function to results
   - Assign rank scores and sort

5. **Formatting**:
   - Select template
   - Estimate tokens for each memory
   - Truncate to fit budget (keep highest-ranked)
   - Format using template

6. **Return**:
   - Return `ContextResult` with formatted context and metadata

## Error Handling

```typescript
type ContextError =
  | { type: 'embedding_error'; message: string; cause?: unknown }
  | { type: 'search_error'; message: string; cause?: unknown }
  | { type: 'storage_error'; message: string; cause?: unknown }
  | { type: 'validation_error'; message: string }
  | { type: 'template_not_found'; template: string }

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

Error handling strategy:
- Embedding failures: return error, don't fall back to empty results
- Search failures: return error with context
- Storage failures: propagate Storage Layer errors
- Template not found: return error with available templates
- When errors occur, log with query context but don't expose internal details

## Usage Examples

### Basic Search

```typescript
const contextEngine = new ContextEngine({
  storageClient,
  embeddingProvider: new OpenAIEmbeddingProvider({
    apiKey: process.env.OPENAI_API_KEY
  })
})

const result = await contextEngine.search(
  'What did we discuss about the project timeline?',
  workspaceId,
  { limit: 5, memoryTypes: ['fact', 'decision'] }
)

if (!result.ok) {
  console.error('Search failed:', result.error)
  return
}

const memories = result.value
```

### Build Context for AI Prompt

```typescript
const contextResult = await contextEngine.buildContext(
  userMessage,
  workspaceId,
  {
    template: 'chat',
    tokenBudget: 1500,
    includeRelationships: true,
    relationshipDepth: 1
  }
)

if (!contextResult.ok) {
  // Fall back to no context
  return { context: '', memories: [] }
}

const { context, tokenCount, truncated } = contextResult.value

// Inject into AI prompt
const prompt = `${context}\n\nUser: ${userMessage}\nAssistant:`
```

### Preview Context

```typescript
const preview = await contextEngine.previewContext(
  userMessage,
  workspaceId,
  { template: 'detailed', tokenBudget: 2000 }
)

if (!preview.ok) {
  console.error('Preview failed:', preview.error)
  return
}

console.log('Context preview:')
console.log(`- Token count: ${preview.value.tokenCount}`)
console.log(`- Memories included: ${preview.value.memoryIds.length}`)
console.log(`- Truncated: ${preview.value.truncated}`)
console.log(`- Budget used: ${preview.value.budgetUsed}%`)
```

### Custom Template

```typescript
contextEngine.registerTemplate('code-focused', {
  name: 'code-focused',
  header: '# Relevant Code Context\n\n',
  memoryFormat: '## {{type}}\n```\n{{content}}\n```\n',
  separator: '\n',
  footer: '\n---\n',
  includeMetadata: true
})

const result = await contextEngine.buildContext(query, workspaceId, {
  template: 'code-focused'
})
```

### Custom Ranking

```typescript
contextEngine.registerRanker('recent-only', (results) => {
  return results.sort((a, b) => {
    const dateA = new Date(a.memory.created_at).getTime()
    const dateB = new Date(b.memory.created_at).getTime()
    return dateB - dateA
  })
})

const result = await contextEngine.buildContext(query, workspaceId, {
  ranker: 'recent-only'
})
```

## MVP Scope

For initial implementation (hackathon/v1), focus on:

1. **Single Embedding Provider**: OpenAI embeddings
2. **Core Search**: Text query → embedding → vector search
3. **Basic Ranking**: Default ranking with similarity + recency + confidence
4. **Default Templates**: chat, detailed, summary
5. **Token Counting**: Tiktoken for OpenAI models, character fallback
6. **Basic Caching**: In-memory embedding cache

Future expansion (post-MVP):
- Additional embedding providers
- Advanced ranking strategies
- More template options
- Persistent cache (Redis)
- Batch search operations
- Search analytics

## Testing Strategy

### Unit Tests

- Test embedding cache with various queries
- Test ranking functions with different weights
- Test formatter with various templates and budgets
- Test tokenizer accuracy
- Test template variable substitution

### Integration Tests

- Test end-to-end search with real Storage Layer
- Test context building with real embeddings
- Test relationship expansion
- Test token budget enforcement
- Test preview matches final output
- Test custom templates and rankers

### Test Data

- Use real memory data from Storage Layer tests
- Create test queries with known relevant memories
- Test edge cases (empty results, budget exceeded, very long memories)
- Test with different memory types and confidence levels
