# Design Document: Conversation Chunking for Large Context Windows

## Overview

This design adds intelligent conversation chunking to the memory extraction system, enabling processing of arbitrarily large conversations that exceed LLM context windows. The solution includes token counting, multiple chunking strategies, cross-chunk deduplication, and comprehensive error handling.

## Architecture

### High-Level Flow

```
Conversation Input
       ↓
Token Counter (estimate size)
       ↓
   [Exceeds limit?]
       ↓ Yes
Chunking Strategy (split conversation)
       ↓
Extract from Each Chunk (parallel/sequential)
       ↓
Deduplicate Across Chunks
       ↓
Merge Relationships
       ↓
Return Combined Results
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   MemoryExtractor                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │         ChunkingOrchestrator                       │ │
│  │  - Decides if chunking needed                      │ │
│  │  - Selects strategy                                │ │
│  │  - Coordinates extraction                          │ │
│  └────────────────────────────────────────────────────┘ │
│                          │                               │
│         ┌────────────────┼────────────────┐             │
│         ↓                ↓                ↓             │
│  ┌──────────┐   ┌──────────────┐  ┌──────────────┐    │
│  │  Token   │   │   Chunking   │  │    Chunk     │    │
│  │ Counter  │   │  Strategies  │  │ Deduplicator │    │
│  └──────────┘   └──────────────┘  └──────────────┘    │
│                          │                               │
│                          ↓                               │
│              ┌───────────────────────┐                  │
│              │ - SlidingWindow       │                  │
│              │ - ConversationBoundary│                  │
│              │ - Semantic            │                  │
│              └───────────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Token Counter

**Purpose:** Estimate token counts for text to determine if chunking is needed.

**Interface:**
```typescript
interface TokenCounter {
  /**
   * Count tokens in text using specified method
   */
  count(text: string, method: TokenCountMethod): number;
  
  /**
   * Count tokens in a conversation
   */
  countConversation(conversation: NormalizedConversation, method: TokenCountMethod): number;
  
  /**
   * Get recommended method for a provider
   */
  getRecommendedMethod(provider: string): TokenCountMethod;
}

type TokenCountMethod = 
  | 'openai-tiktoken'    // Accurate for OpenAI models
  | 'anthropic-estimate' // Estimate for Claude
  | 'gemini-estimate'    // Estimate for Gemini
  | 'approximate';       // Fast approximation (length / 4)

interface TokenCountResult {
  tokens: number;
  method: TokenCountMethod;
  accuracy: 'exact' | 'estimated' | 'approximate';
}
```

**Implementation:**
- Use `tiktoken` library for OpenAI models (exact)
- Use character-based estimation for other providers
- Cache token counts to avoid recomputation
- Provide accuracy metadata with results

### 2. Chunking Strategies

**Base Interface:**
```typescript
interface ChunkingStrategy {
  readonly name: string;
  
  /**
   * Split conversation into chunks
   */
  chunk(
    conversation: NormalizedConversation,
    config: ChunkingConfig
  ): ConversationChunk[];
  
  /**
   * Validate that this strategy can handle the conversation
   */
  canHandle(conversation: NormalizedConversation, config: ChunkingConfig): boolean;
}

interface ChunkingConfig {
  maxTokensPerChunk: number;      // e.g., 100000
  overlapTokens?: number;          // e.g., 1000
  overlapPercentage?: number;      // e.g., 0.1 (10%)
  minChunkSize?: number;           // e.g., 10000
  strategy: 'sliding-window' | 'conversation-boundary' | 'semantic' | 'custom';
  preserveMessageBoundaries: boolean; // default: true
  tokenCountMethod: TokenCountMethod;
}

interface ConversationChunk {
  id: string;                      // Unique chunk ID
  conversationId: string;          // Original conversation ID
  sequence: number;                // Chunk number (1-based)
  totalChunks: number;             // Total number of chunks
  messages: NormalizedMessage[];   // Messages in this chunk
  tokenCount: number;              // Estimated tokens in chunk
  overlapWithPrevious: number;     // Number of overlapping messages with previous chunk
  overlapWithNext: number;         // Number of overlapping messages with next chunk
  metadata: {
    startMessageIndex: number;     // Index of first message in original conversation
    endMessageIndex: number;       // Index of last message in original conversation
    chunkingStrategy: string;      // Strategy used to create this chunk
    createdAt: string;             // ISO timestamp
  };
}
```

#### Strategy 1: Sliding Window

**Algorithm:**
1. Calculate target chunk size (maxTokensPerChunk - overlapTokens)
2. Start from first message
3. Add messages until target size reached
4. Create chunk with overlap from previous chunk
5. Move window forward by (chunk size - overlap)
6. Repeat until all messages processed

**Pseudocode:**
```typescript
function slidingWindowChunk(conversation, config) {
  const chunks = [];
  const targetSize = config.maxTokensPerChunk - config.overlapTokens;
  let currentIndex = 0;
  let overlapMessages = [];
  
  while (currentIndex < conversation.messages.length) {
    const chunk = {
      messages: [...overlapMessages],
      tokenCount: countTokens(overlapMessages)
    };
    
    // Add messages until we reach target size
    while (currentIndex < conversation.messages.length) {
      const message = conversation.messages[currentIndex];
      const messageTokens = countTokens(message);
      
      if (chunk.tokenCount + messageTokens > config.maxTokensPerChunk) {
        break;
      }
      
      chunk.messages.push(message);
      chunk.tokenCount += messageTokens;
      currentIndex++;
    }
    
    chunks.push(chunk);
    
    // Calculate overlap for next chunk
    overlapMessages = calculateOverlap(chunk.messages, config.overlapTokens);
  }
  
  return chunks;
}
```

#### Strategy 2: Conversation Boundary

**Algorithm:**
1. Identify potential split points (user messages, topic shifts)
2. Score each split point based on context continuity
3. Select split points that create balanced chunks
4. Ensure chunks don't exceed max size
5. Add minimal overlap at boundaries

**Heuristics for Split Points:**
- User messages (natural turn-taking)
- Long pauses in conversation (timestamp gaps)
- Explicit topic markers ("Let's talk about...", "Moving on to...")
- Message count thresholds (every N messages)

#### Strategy 3: Semantic

**Algorithm:**
1. Generate embeddings for each message (or use keyword extraction)
2. Calculate similarity between adjacent messages
3. Identify low-similarity boundaries (topic shifts)
4. Create chunks at topic boundaries
5. Ensure chunks respect size limits

**Simplified Implementation:**
- Use keyword extraction (TF-IDF) instead of embeddings
- Calculate keyword overlap between messages
- Split where overlap is lowest
- Fall back to sliding window if no clear boundaries

### 3. Chunking Orchestrator

**Purpose:** Coordinate the chunking and extraction process.

**Interface:**
```typescript
class ChunkingOrchestrator {
  constructor(
    private tokenCounter: TokenCounter,
    private strategies: Map<string, ChunkingStrategy>,
    private deduplicator: ChunkDeduplicator
  ) {}
  
  /**
   * Determine if conversation needs chunking
   */
  needsChunking(
    conversation: NormalizedConversation,
    config: ChunkingConfig
  ): boolean;
  
  /**
   * Extract memories from a potentially large conversation
   */
  async extractWithChunking(
    conversation: NormalizedConversation,
    workspaceId: string,
    extractor: MemoryExtractor,
    config: ChunkingConfig
  ): Promise<ChunkedExtractionResult>;
}

interface ChunkedExtractionResult {
  memories: ExtractedMemory[];
  relationships: ExtractedRelationship[];
  chunks: ChunkExtractionResult[];
  totalTokens: number;
  chunkingStrategy: string;
  processingTime: number;
}

interface ChunkExtractionResult {
  chunkId: string;
  sequence: number;
  status: 'success' | 'failed';
  memories: ExtractedMemory[];
  relationships: ExtractedRelationship[];
  tokenCount: number;
  processingTime: number;
  error?: ExtractionError;
}
```

### 4. Chunk Deduplicator

**Purpose:** Merge duplicate memories extracted from overlapping chunks.

**Interface:**
```typescript
class ChunkDeduplicator {
  /**
   * Deduplicate memories across chunks
   */
  deduplicateAcrossChunks(
    chunkResults: ChunkExtractionResult[]
  ): DeduplicationResult;
  
  /**
   * Merge relationships across chunks
   */
  mergeRelationships(
    memories: ExtractedMemory[],
    relationships: ExtractedRelationship[]
  ): ExtractedRelationship[];
}

interface DeduplicationResult {
  uniqueMemories: ExtractedMemory[];
  duplicatesFound: number;
  mergedMemories: Array<{
    finalMemory: ExtractedMemory;
    sourceMemories: ExtractedMemory[];
    sourceChunks: string[];
  }>;
}
```

**Deduplication Algorithm:**
1. Group memories by type
2. Within each type, calculate similarity scores
3. Use content similarity (cosine similarity, Levenshtein distance)
4. Merge memories with similarity > threshold (e.g., 0.85)
5. Keep highest confidence score
6. Preserve all source chunk references
7. Update relationship references to merged memory IDs

## Data Models

### Extended Memory Model

```typescript
interface ExtractedMemory {
  // ... existing fields ...
  
  // New fields for chunking
  source_chunks?: string[];        // IDs of chunks this memory came from
  chunk_confidence?: number[];     // Confidence from each chunk
  merged_from?: string[];          // IDs of memories this was merged from
}
```

### Chunking Metadata

```typescript
interface ChunkingMetadata {
  enabled: boolean;
  strategy: string;
  totalChunks: number;
  totalTokens: number;
  averageTokensPerChunk: number;
  overlapTokens: number;
  processingTime: {
    chunking: number;
    extraction: number;
    deduplication: number;
    total: number;
  };
}
```

## Integration with Existing System

### Changes to MemoryExtractor

```typescript
class MemoryExtractor {
  private chunkingOrchestrator?: ChunkingOrchestrator;
  
  constructor(config: MemoryExtractorConfig) {
    // ... existing code ...
    
    // Initialize chunking if enabled
    if (config.chunking?.enabled) {
      this.chunkingOrchestrator = new ChunkingOrchestrator(
        new TokenCounter(),
        this.loadChunkingStrategies(),
        new ChunkDeduplicator()
      );
    }
  }
  
  async extract(
    conversation: NormalizedConversation,
    workspaceId: string,
    options?: ExtractionOptions
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    // Check if chunking is needed
    if (this.chunkingOrchestrator && 
        this.chunkingOrchestrator.needsChunking(conversation, this.config.chunking)) {
      return this.extractWithChunking(conversation, workspaceId, options);
    }
    
    // Existing extraction logic for small conversations
    return this.extractNormal(conversation, workspaceId, options);
  }
  
  private async extractWithChunking(...) {
    // Delegate to chunking orchestrator
    return this.chunkingOrchestrator.extractWithChunking(...);
  }
}
```

### Configuration Extension

```typescript
interface MemoryExtractorConfig {
  // ... existing fields ...
  
  chunking?: {
    enabled: boolean;
    maxTokensPerChunk: number;
    overlapTokens?: number;
    overlapPercentage?: number;
    strategy: 'sliding-window' | 'conversation-boundary' | 'semantic';
    tokenCountMethod?: TokenCountMethod;
    failureMode: 'fail-fast' | 'continue-on-error';
    parallelChunks?: number;  // Max parallel chunk processing
  };
}
```

## Error Handling

### Chunk Extraction Failures

**Strategy:** Continue processing remaining chunks, collect errors

```typescript
async function extractFromChunks(chunks) {
  const results = [];
  const errors = [];
  
  for (const chunk of chunks) {
    try {
      const result = await extractFromChunk(chunk);
      results.push(result);
    } catch (error) {
      errors.push({ chunkId: chunk.id, error });
      
      if (config.failureMode === 'fail-fast') {
        throw new ChunkExtractionError(errors);
      }
      
      // Continue with next chunk
      logger.warn(`Chunk ${chunk.id} failed, continuing...`, error);
    }
  }
  
  return { results, errors };
}
```

### Token Count Estimation Errors

**Strategy:** Fall back to approximate counting

```typescript
function countTokens(text, method) {
  try {
    return exactCount(text, method);
  } catch (error) {
    logger.warn('Exact counting failed, using approximation', error);
    return approximateCount(text);
  }
}
```

## Testing Strategy

### Unit Tests
- Token counter accuracy (compare with known counts)
- Each chunking strategy with various conversation sizes
- Deduplication logic with overlapping memories
- Edge cases (empty conversations, single message, etc.)

### Integration Tests
- End-to-end chunking with real conversations
- Cross-chunk memory deduplication
- Relationship preservation across chunks
- Error handling with partial failures

### Performance Tests
- Large conversation processing (1M+ tokens)
- Chunking overhead measurement
- Memory usage with many chunks
- Parallel vs sequential chunk processing

## Performance Considerations

### Token Counting
- Cache token counts for messages
- Use approximate counting for initial size check
- Only use exact counting when near limits

### Chunk Processing
- Process chunks sequentially to maintain context
- Optional parallel processing for independent chunks
- Stream results as chunks complete

### Memory Usage
- Don't load all chunks into memory at once
- Stream chunk results to deduplicator
- Clean up processed chunks

## Migration Path

### Phase 1: Add Token Counting (Non-breaking)
- Add TokenCounter utility
- Add token count logging
- No behavior changes

### Phase 2: Add Sliding Window Strategy (Opt-in)
- Implement basic chunking
- Disabled by default
- Users opt-in via config

### Phase 3: Add Advanced Strategies (Enhancement)
- Add conversation boundary strategy
- Add semantic strategy
- Improve deduplication

### Phase 4: Enable by Default (Breaking)
- Enable chunking by default with sensible limits
- Provide migration guide
- Document performance implications

## Open Questions

1. **Should chunking be enabled by default?**
   - Recommendation: Yes, with high limits (e.g., 500k tokens)
   
2. **Should we support parallel chunk processing?**
   - Recommendation: Yes, but sequential by default for context preservation
   
3. **How to handle streaming extraction with chunking?**
   - Recommendation: Chunk at conversation boundaries, not mid-stream
   
4. **Should we expose chunk-level results to users?**
   - Recommendation: Yes, via optional detailed result format
