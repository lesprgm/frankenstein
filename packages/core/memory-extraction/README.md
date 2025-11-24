# @memorylayer/memory-extraction

Memory extraction module for MemoryLayer. Extracts structured memories (entities, facts, decisions) from conversations using LLM-based analysis.

## Installation

```bash
npm install @memorylayer/memory-extraction
```

## Features

- Extract entities, facts, and decisions from conversations
- Configurable extraction strategies (prompt-based, structured output, function calling)
- Support for multiple LLM providers (OpenAI, Anthropic)
- Batch processing for multiple conversations
- Incremental extraction for streaming conversations
- Memory deduplication and validation
- **Custom memory types** - Define your own memory categories beyond the defaults
- Extraction profiles for different use cases
- **Conversation chunking** - Process arbitrarily large conversations that exceed LLM context windows

## Usage

### Basic Extraction

```typescript
import { MemoryExtractor } from '@memorylayer/memory-extraction';
import { OpenAIProvider } from '@memorylayer/memory-extraction';
import { StructuredOutputStrategy } from '@memorylayer/memory-extraction';

// Create extractor instance
const extractor = new MemoryExtractor({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  strategy: new StructuredOutputStrategy(),
  memoryTypes: ['entity', 'fact', 'decision'],
  minConfidence: 0.6
});

// Extract memories from a conversation
const result = await extractor.extract(conversation, workspaceId);

if (result.ok) {
  const { memories, relationships } = result.value;
  // Process extracted memories
}
```

### Custom Memory Types

You can register custom memory types to extract domain-specific information:

```typescript
import { MemoryTypeConfig } from '@memorylayer/memory-extraction';

// Define a custom "task" memory type
const taskConfig: MemoryTypeConfig = {
  type: 'task',
  extractionPrompt: 'Extract action items and tasks from the conversation',
  schema: {
    type: 'object',
    properties: {
      task: { type: 'string' },
      assignee: { type: 'string' },
      dueDate: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] }
    },
    required: ['task']
  },
  validator: (memory) => {
    // Optional custom validation
    return memory.metadata.task && memory.metadata.task.length > 5;
  }
};

// Register the custom type
extractor.registerMemoryType('task', taskConfig);

// Now extract with the custom type included
const result = await extractor.extract(conversation, workspaceId, {
  memoryTypes: ['entity', 'fact', 'task']
});
```

#### Custom Memory Type Configuration

A `MemoryTypeConfig` has the following properties:

- **type** (required): The name of the memory type
- **extractionPrompt** (required): Instructions for the LLM on how to extract this type
- **schema** (optional): JSON schema defining the expected metadata structure
- **validator** (optional): Custom validation function for additional checks

See `examples/custom-memory-types.ts` for more detailed examples.

### Conversation Chunking

For large conversations that exceed LLM context windows, enable automatic chunking:

```typescript
const extractor = new MemoryExtractor({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4-turbo',
  }),
  strategy: new StructuredOutputStrategy(),
  
  // Enable chunking for large conversations
  chunking: {
    enabled: true,
    maxTokensPerChunk: 100000,      // Maximum tokens per chunk
    strategy: 'sliding-window',      // Chunking strategy
    overlapPercentage: 0.1,          // 10% overlap between chunks
    failureMode: 'continue-on-error', // Continue if a chunk fails
  },
});

// Extract from large conversation - chunking happens automatically
const result = await extractor.extract(largeConversation, workspaceId);

if (result.ok && result.value.chunkingMetadata) {
  console.log(`Processed ${result.value.chunkingMetadata.totalChunks} chunks`);
  console.log(`Total tokens: ${result.value.chunkingMetadata.totalTokens}`);
}
```

**Chunking strategies:**
- `sliding-window`: Fixed-size overlapping windows (default, most reliable)
- `conversation-boundary`: Split at natural conversation breaks
- `semantic`: Split based on topic changes

See [CHUNKING.md](./CHUNKING.md) for complete documentation, [TOKEN_COUNTING.md](./TOKEN_COUNTING.md) for token counting accuracy details, and [MIGRATION.md](./MIGRATION.md) for enabling chunking in existing applications.

## Development

```bash
# Build
npm run build

# Test
npm test

# Test in watch mode
npm run test:watch
```

## License

MIT
