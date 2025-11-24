/**
 * Demo script showing chunking monitoring and logging features
 * 
 * This demonstrates:
 * - Chunking metrics collection
 * - Detailed logging for chunking operations
 * - Chunking metadata in extraction results
 */

import { MemoryExtractor } from '../src/index.js';
import type { NormalizedConversation, Logger } from '../src/types.js';

// Create a custom logger that captures all logs
class DemoLogger implements Logger {
  private logs: Array<{ level: string; message: string; data?: any }> = [];

  debug(message: string, data?: any): void {
    this.logs.push({ level: 'DEBUG', message, data });
    console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  info(message: string, data?: any): void {
    this.logs.push({ level: 'INFO', message, data });
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  warn(message: string, data?: any): void {
    this.logs.push({ level: 'WARN', message, data });
    console.warn(`[WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  error(message: string, data?: any): void {
    this.logs.push({ level: 'ERROR', message, data });
    console.error(`[ERROR] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  getLogs() {
    return this.logs;
  }

  getLogsByLevel(level: string) {
    return this.logs.filter(log => log.level === level);
  }
}

// Mock LLM Provider for demo
class MockProvider {
  readonly name = 'mock-provider';

  async complete(prompt: string): Promise<string> {
    return JSON.stringify({
      memories: [
        {
          type: 'entity',
          content: 'Demo entity',
          confidence: 0.9,
        },
      ],
      relationships: [],
    });
  }

  async completeStructured<T>(prompt: string, schema: any): Promise<T> {
    return {
      memories: [
        {
          type: 'entity',
          content: 'Demo entity from chunk',
          confidence: 0.9,
        },
      ],
      relationships: [],
    } as T;
  }

  async completeWithFunctions(): Promise<any> {
    return { functionName: 'extract', arguments: {} };
  }
}

// Mock extraction strategy
class MockStrategy {
  readonly name = 'mock-strategy';

  async extract(conversation: NormalizedConversation, workspaceId: string, config: any) {
    return {
      memories: [
        {
          type: 'entity',
          content: `Entity from conversation ${conversation.id}`,
          confidence: 0.9,
          source_message_ids: conversation.messages.map(m => m.id),
        },
      ],
      relationships: [],
    };
  }

  async extractIncremental() {
    return { memories: [], relationships: [] };
  }
}

// Create a large conversation that will trigger chunking
function createLargeConversation(messageCount: number): NormalizedConversation {
  const messages = [];
  
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `This is message ${i}. `.repeat(100), // Make each message ~1500 characters
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    });
  }

  return {
    id: 'large-conversation-demo',
    messages,
    metadata: {},
  };
}

async function runDemo() {
  console.log('='.repeat(80));
  console.log('Chunking Monitoring and Logging Demo');
  console.log('='.repeat(80));
  console.log();

  // Create logger
  const logger = new DemoLogger();

  // Create extractor with chunking enabled
  const extractor = new MemoryExtractor({
    provider: new MockProvider() as any,
    strategy: new MockStrategy() as any,
    logger,
    chunking: {
      enabled: true,
      maxTokensPerChunk: 5000, // Small chunk size to trigger chunking
      overlapPercentage: 0.1,
      strategy: 'sliding-window',
      tokenCountMethod: 'approximate',
      failureMode: 'continue-on-error',
    },
  });

  // Create a large conversation
  const conversation = createLargeConversation(50); // 50 messages

  console.log(`Created conversation with ${conversation.messages.length} messages`);
  console.log();

  // Extract memories
  console.log('Starting extraction with chunking...');
  console.log();

  const result = await extractor.extract(conversation, 'demo-workspace');

  if (result.ok) {
    console.log();
    console.log('='.repeat(80));
    console.log('Extraction Results');
    console.log('='.repeat(80));
    console.log();
    console.log(`Status: ${result.value.status}`);
    console.log(`Memories extracted: ${result.value.memories.length}`);
    console.log(`Relationships extracted: ${result.value.relationships.length}`);
    console.log();

    // Display chunking metadata
    if (result.value.chunkingMetadata) {
      console.log('='.repeat(80));
      console.log('Chunking Metadata');
      console.log('='.repeat(80));
      console.log();
      console.log(JSON.stringify(result.value.chunkingMetadata, null, 2));
      console.log();

      // Highlight key metrics
      console.log('Key Metrics:');
      console.log(`  - Total chunks: ${result.value.chunkingMetadata.totalChunks}`);
      console.log(`  - Total tokens: ${result.value.chunkingMetadata.totalTokens}`);
      console.log(`  - Avg tokens per chunk: ${result.value.chunkingMetadata.averageTokensPerChunk}`);
      console.log(`  - Strategy used: ${result.value.chunkingMetadata.strategy}`);
      console.log();
      console.log('Processing Time Breakdown:');
      console.log(`  - Chunking: ${result.value.chunkingMetadata.processingTime.chunking}ms`);
      console.log(`  - Extraction: ${result.value.chunkingMetadata.processingTime.extraction}ms`);
      console.log(`  - Deduplication: ${result.value.chunkingMetadata.processingTime.deduplication}ms`);
      console.log(`  - Total: ${result.value.chunkingMetadata.processingTime.total}ms`);
      console.log();
      console.log('Chunk Size Statistics:');
      console.log(`  - Min: ${result.value.chunkingMetadata.chunkSizes.min} tokens`);
      console.log(`  - Max: ${result.value.chunkingMetadata.chunkSizes.max} tokens`);
      console.log(`  - Avg: ${result.value.chunkingMetadata.chunkSizes.avg} tokens`);
      console.log();
      console.log('Extraction Rate:');
      console.log(`  - Memories per chunk: ${result.value.chunkingMetadata.extractionRate.memoriesPerChunk}`);
      console.log(`  - Relationships per chunk: ${result.value.chunkingMetadata.extractionRate.relationshipsPerChunk}`);
    }

    // Display log summary
    console.log();
    console.log('='.repeat(80));
    console.log('Log Summary');
    console.log('='.repeat(80));
    console.log();
    const logs = logger.getLogs();
    console.log(`Total logs: ${logs.length}`);
    console.log(`  - DEBUG: ${logger.getLogsByLevel('DEBUG').length}`);
    console.log(`  - INFO: ${logger.getLogsByLevel('INFO').length}`);
    console.log(`  - WARN: ${logger.getLogsByLevel('WARN').length}`);
    console.log(`  - ERROR: ${logger.getLogsByLevel('ERROR').length}`);
    console.log();

    // Show key log messages
    console.log('Key Log Messages:');
    const infoLogs = logger.getLogsByLevel('INFO');
    const chunkingLogs = infoLogs.filter(log => 
      log.message.includes('chunk') || 
      log.message.includes('Chunk') ||
      log.message.includes('deduplication')
    );
    
    chunkingLogs.forEach(log => {
      console.log(`  - ${log.message}`);
    });
  } else {
    console.error('Extraction failed:', result.error);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('Demo Complete');
  console.log('='.repeat(80));
}

// Run the demo
runDemo().catch(console.error);
