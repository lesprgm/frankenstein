/**
 * Example: Processing Large Conversations with Chunking
 * 
 * This example demonstrates how to extract memories from large conversations
 * that exceed LLM context windows using automatic chunking.
 */

import { MemoryExtractor } from '../src/index.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { StructuredOutputStrategy } from '../src/strategies/structured.js';
import type { NormalizedConversation, NormalizedMessage } from '../src/types.js';

/**
 * Create a large conversation for testing chunking
 */
function createLargeConversation(messageCount: number = 200): NormalizedConversation {
  const messages: NormalizedMessage[] = [];
  const topics = [
    'project planning',
    'technical architecture',
    'database design',
    'API development',
    'frontend implementation',
    'testing strategy',
    'deployment process',
    'performance optimization'
  ];

  for (let i = 0; i < messageCount; i++) {
    const topic = topics[Math.floor(i / 25) % topics.length];
    const isUser = i % 2 === 0;

    messages.push({
      id: `msg-${i}`,
      role: isUser ? 'user' : 'assistant',
      content: isUser
        ? `Let's discuss ${topic}. I think we should focus on scalability and maintainability. 
           What are your thoughts on the best approach? We need to consider performance, 
           cost, and developer experience. ${generateDetailedContent(i)}`
        : `Great question about ${topic}. Based on my analysis, I recommend the following approach:
           1. Start with a solid foundation
           2. Implement incrementally
           3. Test thoroughly at each stage
           4. Monitor performance metrics
           ${generateDetailedContent(i)}`,
      timestamp: new Date(Date.now() + i * 60000).toISOString(),
    });
  }

  return {
    id: 'large-conversation-example',
    messages,
    metadata: {
      title: 'Large Project Discussion',
      participants: ['user', 'assistant'],
    },
  };
}

/**
 * Generate detailed content to make messages longer
 */
function generateDetailedContent(index: number): string {
  const details = [
    'We should consider using TypeScript for better type safety.',
    'The database schema needs to support future extensions.',
    'API endpoints should follow RESTful conventions.',
    'We need comprehensive error handling throughout.',
    'Documentation is crucial for maintainability.',
    'Security should be built in from the start.',
    'Performance testing should be automated.',
    'Code reviews will help maintain quality.',
  ];

  return details[index % details.length] + ' ' + 
         'This is important because it affects the overall system architecture and long-term maintainability. ' +
         'We should also think about how this integrates with our existing infrastructure.';
}

/**
 * Example 1: Basic chunking with default settings
 */
async function basicChunkingExample() {
  console.log('\n' + '='.repeat(80));
  console.log('Example 1: Basic Chunking with Default Settings');
  console.log('='.repeat(80) + '\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    memoryTypes: ['entity', 'fact', 'decision'],
    
    // Enable chunking with sensible defaults
    chunking: {
      enabled: true,
      maxTokensPerChunk: 100000,      // 100k tokens per chunk
      strategy: 'sliding-window',      // Use sliding window strategy
      overlapPercentage: 0.1,          // 10% overlap
      failureMode: 'continue-on-error', // Continue if a chunk fails
    },
  });

  const conversation = createLargeConversation(200);
  console.log(`Created conversation with ${conversation.messages.length} messages`);

  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok) {
    console.log('\n✓ Extraction successful!');
    console.log(`  Memories extracted: ${result.value.memories.length}`);
    console.log(`  Relationships: ${result.value.relationships.length}`);

    if (result.value.chunkingMetadata) {
      console.log('\nChunking Details:');
      console.log(`  Strategy: ${result.value.chunkingMetadata.strategy}`);
      console.log(`  Total chunks: ${result.value.chunkingMetadata.totalChunks}`);
      console.log(`  Total tokens: ${result.value.chunkingMetadata.totalTokens}`);
      console.log(`  Avg tokens/chunk: ${result.value.chunkingMetadata.averageTokensPerChunk}`);
      console.log(`  Processing time: ${result.value.chunkingMetadata.processingTime.total}ms`);
    }
  } else {
    console.error('✗ Extraction failed:', result.error);
  }
}

/**
 * Example 2: Chunking with different strategies
 */
async function strategyComparisonExample() {
  console.log('\n' + '='.repeat(80));
  console.log('Example 2: Comparing Chunking Strategies');
  console.log('='.repeat(80) + '\n');

  const conversation = createLargeConversation(150);
  const strategies = ['sliding-window', 'conversation-boundary', 'semantic'] as const;

  for (const strategy of strategies) {
    console.log(`\nTesting strategy: ${strategy}`);
    console.log('-'.repeat(40));

    const extractor = new MemoryExtractor({
      provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
        model: 'gpt-4-turbo',
      }),
      strategy: new StructuredOutputStrategy(),
      memoryTypes: ['entity', 'fact', 'decision'],
      
      chunking: {
        enabled: true,
        maxTokensPerChunk: 80000,
        strategy: strategy,
        overlapPercentage: 0.1,
        failureMode: 'continue-on-error',
      },
    });

    const startTime = Date.now();
    const result = await extractor.extract(conversation, 'workspace-1');
    const totalTime = Date.now() - startTime;

    if (result.ok && result.value.chunkingMetadata) {
      const meta = result.value.chunkingMetadata;
      console.log(`  Chunks created: ${meta.totalChunks}`);
      console.log(`  Avg chunk size: ${meta.averageTokensPerChunk} tokens`);
      console.log(`  Memories extracted: ${result.value.memories.length}`);
      console.log(`  Total time: ${totalTime}ms`);
      console.log(`  Time breakdown:`);
      console.log(`    - Chunking: ${meta.processingTime.chunking}ms`);
      console.log(`    - Extraction: ${meta.processingTime.extraction}ms`);
      console.log(`    - Deduplication: ${meta.processingTime.deduplication}ms`);
    }
  }
}

/**
 * Example 3: Custom chunking configuration
 */
async function customConfigurationExample() {
  console.log('\n' + '='.repeat(80));
  console.log('Example 3: Custom Chunking Configuration');
  console.log('='.repeat(80) + '\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    memoryTypes: ['entity', 'fact', 'decision'],
    
    // Custom configuration for specific use case
    chunking: {
      enabled: true,
      maxTokensPerChunk: 120000,       // Larger chunks
      strategy: 'conversation-boundary', // Natural breaks
      overlapTokens: 500,               // Fixed overlap
      minChunkSize: 20000,              // Minimum chunk size
      tokenCountMethod: 'openai-tiktoken', // Exact counting
      failureMode: 'continue-on-error',
      parallelChunks: 2,                // Process 2 chunks at once
      preserveMessageBoundaries: true,  // Never split messages
    },
  });

  const conversation = createLargeConversation(180);
  console.log(`Processing conversation with ${conversation.messages.length} messages`);

  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok) {
    console.log('\n✓ Extraction complete!');
    console.log(`  Memories: ${result.value.memories.length}`);
    
    if (result.value.chunkingMetadata) {
      console.log('\nConfiguration Impact:');
      console.log(`  Chunks created: ${result.value.chunkingMetadata.totalChunks}`);
      console.log(`  Chunk sizes: ${result.value.chunkingMetadata.chunkSizes.min} - ${result.value.chunkingMetadata.chunkSizes.max} tokens`);
      console.log(`  Parallel processing: ${result.value.chunkingMetadata.parallelChunks || 1} chunks at once`);
    }

    // Show memory distribution across chunks
    const memoriesByChunk = new Map<string, number>();
    result.value.memories.forEach(memory => {
      if (memory.source_chunks) {
        memory.source_chunks.forEach(chunkId => {
          memoriesByChunk.set(chunkId, (memoriesByChunk.get(chunkId) || 0) + 1);
        });
      }
    });

    console.log('\nMemory Distribution:');
    memoriesByChunk.forEach((count, chunkId) => {
      console.log(`  ${chunkId}: ${count} memories`);
    });
  }
}

/**
 * Example 4: Handling chunk failures
 */
async function errorHandlingExample() {
  console.log('\n' + '='.repeat(80));
  console.log('Example 4: Error Handling with Chunking');
  console.log('='.repeat(80) + '\n');

  // Test with fail-fast mode
  console.log('Testing fail-fast mode:');
  const failFastExtractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 100000,
      strategy: 'sliding-window',
      overlapPercentage: 0.1,
      failureMode: 'fail-fast', // Stop on first error
    },
  });

  const conversation = createLargeConversation(100);
  const result1 = await failFastExtractor.extract(conversation, 'workspace-1');

  if (result1.ok) {
    console.log('  ✓ All chunks processed successfully');
  } else {
    console.log('  ✗ Extraction stopped on first error');
    console.log(`  Error: ${result1.error.message}`);
  }

  // Test with continue-on-error mode
  console.log('\nTesting continue-on-error mode:');
  const continueExtractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 100000,
      strategy: 'sliding-window',
      overlapPercentage: 0.1,
      failureMode: 'continue-on-error', // Continue despite errors
    },
  });

  const result2 = await continueExtractor.extract(conversation, 'workspace-1');

  if (result2.ok) {
    console.log('  ✓ Extraction completed with partial results');
    console.log(`  Memories extracted: ${result2.value.memories.length}`);

    // Check for chunk failures
    if (result2.value.chunkingMetadata?.chunks) {
      const failedChunks = result2.value.chunkingMetadata.chunks.filter(
        c => c.status === 'failed'
      );
      
      if (failedChunks.length > 0) {
        console.log(`\n  ⚠ ${failedChunks.length} chunks failed:`);
        failedChunks.forEach(chunk => {
          console.log(`    - Chunk ${chunk.sequence}: ${chunk.error?.message}`);
        });
      } else {
        console.log('  ✓ All chunks processed successfully');
      }
    }
  }
}

/**
 * Example 5: Monitoring chunking performance
 */
async function performanceMonitoringExample() {
  console.log('\n' + '='.repeat(80));
  console.log('Example 5: Performance Monitoring');
  console.log('='.repeat(80) + '\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 100000,
      strategy: 'sliding-window',
      overlapPercentage: 0.1,
      failureMode: 'continue-on-error',
    },
  });

  const conversationSizes = [50, 100, 200, 300];

  console.log('Testing different conversation sizes:\n');
  console.log('Size | Chunks | Memories | Time (ms) | Mem/Chunk | Time/Chunk');
  console.log('-'.repeat(70));

  for (const size of conversationSizes) {
    const conversation = createLargeConversation(size);
    const startTime = Date.now();
    const result = await extractor.extract(conversation, 'workspace-1');
    const totalTime = Date.now() - startTime;

    if (result.ok && result.value.chunkingMetadata) {
      const meta = result.value.chunkingMetadata;
      const memoriesPerChunk = (result.value.memories.length / meta.totalChunks).toFixed(1);
      const timePerChunk = (totalTime / meta.totalChunks).toFixed(0);

      console.log(
        `${size.toString().padEnd(4)} | ` +
        `${meta.totalChunks.toString().padEnd(6)} | ` +
        `${result.value.memories.length.toString().padEnd(8)} | ` +
        `${totalTime.toString().padEnd(9)} | ` +
        `${memoriesPerChunk.padEnd(9)} | ` +
        `${timePerChunk}`
      );
    }
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('\n' + '='.repeat(80));
  console.log('Large Conversation Chunking Examples');
  console.log('='.repeat(80));

  try {
    await basicChunkingExample();
    await strategyComparisonExample();
    await customConfigurationExample();
    await errorHandlingExample();
    await performanceMonitoringExample();

    console.log('\n' + '='.repeat(80));
    console.log('All examples completed!');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}

export {
  createLargeConversation,
  basicChunkingExample,
  strategyComparisonExample,
  customConfigurationExample,
  errorHandlingExample,
  performanceMonitoringExample,
};
