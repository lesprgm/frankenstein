# @memorylayer/chat-capture

Chat conversation capture and normalization for MemoryLayer - ingest conversations from ChatGPT, Claude, and other AI providers.

## Features

- **Multi-Provider Support**: Parse ChatGPT and Claude conversation exports
- **Unified Format**: Normalize provider-specific formats into consistent data structures
- **Extensible**: Parser registry for custom providers
- **Flexible Ingestion**: Support for file imports and streaming API captures
- **Type-Safe**: Full TypeScript support with validated schemas

## Installation

```bash
npm install @memorylayer/chat-capture
```

## Quick Start

```typescript
import { ChatCaptureService } from '@memorylayer/chat-capture';

const service = new ChatCaptureService();

// Parse a ChatGPT export file
const result = await service.parseFile('./chatgpt-export.json', 'chatgpt');

if (result.ok) {
  const conversations = result.value;
  console.log(`Parsed ${conversations.length} conversations`);
}
```

## Supported Providers

| Provider | Format | Status |
|----------|--------|--------|
| ChatGPT | JSON export | ✅ Supported |
| Claude | JSON export | ✅ Supported |
| Custom | Adapter API | ✅ Extensible |

## API Overview

### Parse Conversation Files

```typescript
interface ParseResult {
  conversations: NormalizedConversation[];
  metadata: {
    provider: string;
    exportDate: string;
    totalMessages: number;
  };
}

const result = await service.parseFile(filePath, 'chatgpt');
```

### Normalized Format

```typescript
interface NormalizedConversation {
  id: string;
  provider: string;
  title?: string;
  created_at: string;
  updated_at: string;
  messages: NormalizedMessage[];
  metadata: Record<string, any>;
}

interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata: Record<string, any>;
}
```

### Custom Provider Adapters

```typescript
import { ConversationParser } from '@memorylayer/chat-capture';

class MyProviderParser implements ConversationParser {
  provider = 'my-provider';
  
  async parse(data: unknown): Promise<NormalizedConversation[]> {
    // Your parsing logic
    return conversations;
  }
}

service.registerParser(new MyProviderParser());
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch
```

## License

MIT
