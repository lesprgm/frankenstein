/**
 * Example: Comparing Different Chunking Strategies
 * 
 * This example demonstrates the differences between chunking strategies
 * and helps you choose the right one for your use case.
 */

import { MemoryExtractor } from '../src/index.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { StructuredOutputStrategy } from '../src/strategies/structured.js';
import type { NormalizedConversation, NormalizedMessage } from '../src/types.js';

/**
 * Create a conversation with clear topic boundaries
 */
function createTopicalConversation(): NormalizedConversation {
  const messages: NormalizedMessage[] = [
    // Topic 1: Project Setup (messages 0-9)
    {
      id: 'msg-0',
      role: 'user',
      content: 'Let\'s set up the new project. We need to decide on the tech stack.',
      timestamp: '2024-01-15T10:00:00Z',
    },
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'Great! I recommend using React for the frontend and Node.js for the backend.',
      timestamp: '2024-01-15T10:01:00Z',
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Sounds good. What about the database?',
      timestamp: '2024-01-15T10:02:00Z',
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content: 'PostgreSQL would be a solid choice for this use case.',
      timestamp: '2024-01-15T10:03:00Z',
    },
    // ... more messages about project setup
    ...generateMessages('project setup', 4, 10),

    // Topic 2: Authentication (messages 10-19)
    {
      id: 'msg-10',
      role: 'user',
      content: 'Now let\'s talk about authentication. How should we implement it?',
      timestamp: '2024-01-15T10:15:00Z',
    },
    {
      id: 'msg-11',
      role: 'assistant',
      content: 'I suggest using JWT tokens with refresh token rotation for security.',
      timestamp: '2024-01-15T10:16:00Z',
    },
    ...generateMessages('authentication', 12, 20),

    // Topic 3: API Design (messages 20-29)
    {
      id: 'msg-20',
      role: 'user',
      content: 'Moving on to API design. Should we use REST or GraphQL?',
      timestamp: '2024-01-15T10:30:00Z',
    },
    {
      id: 'msg-21',
      role: 'assistant',
      content: 'REST would be simpler to start with. We can add GraphQL later if needed.',
      timestamp: '2024-01-15T10:31:00Z',
    },
    ...generateMessages('API design', 22, 30),

    // Topic 4: Testing Strategy (messages 30-39)
    {
      id: 'msg-30',
      role: 'user',
      content: 'What about testing? We need a comprehensive testing strategy.',
      timestamp: '2024-01-15T10:45:00Z',
    },
    {
      id: 'msg-31',
      role: 'assistant',
      content: 'Let\'s use Jest for unit tests and Playwright for end-to-end testing.',
      timestamp: '2024-01-15T10:46:00Z',
    },
    ...generateMessages('testing strategy', 32, 40),
  ];

  return {
    id: 'topical-conversation',
    messages,
    metadata: {
      title: 'Project Planning Discussion',
    },
  };
}

/**
 * Generate filler messages for a topic
 */
function generateMessages(topic: string, startId: number, endId: number): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  
  for (let i = startId; i < endId; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `This is message ${i} about ${topic}. ${generateDetailedContent()}`,
      timestamp: new Date(Date.parse('2024-01-15T10:00:00Z') + i * 60000).toISOString(),
    });
  }
  
  return messages;
}

/**
 * Generate detailed content to make messages realistic
 */
function generateDetailedContent(): string {
  const details = [
    'We should consider scalability and performance from the start.',
    'Security is a top priority for this feature.',
    'Let\'s make sure the implementation is well-documented.',
    'We need to think about error handling and edge cases.',
    'This approach will make maintenance easier in the long run.',
  ];
  
  return details[Math.floor(Math.random() * details.length)];
}

/**
 * Demo 1: Sliding Window Strategy
 */
async function slidingWindowDemo() {
  console.log('\n' + '='.repeat(80));
  console.log('Demo 1: Sliding Window Strategy');
  console.log('='.repeat(80));
  console.log('\nBest for: General-purpose chunking with predictable behavior');
  console.log('How it works: Creates fixed-size overlapping windows\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 5000,  // Small for demo purposes
      strategy: 'sliding-window',
      overlapPercentage: 0.15,  // 15% overlap
      failureMode: 'continue-on-error',
    },
  });

  const conversation = createTopicalConversation();
  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok && result.value.chunkingMetadata) {
    const meta = result.value.chunkingMetadata;
    
    console.log('Results:');
    console.log(`  ✓ Chunks created: ${meta.totalChunks}`);
    console.log(`  ✓ Chunk sizes: ${meta.chunkSizes.min} - ${meta.chunkSizes.max} tokens`);
    console.log(`  ✓ Average size: ${meta.chunkSizes.avg} tokens`);
    console.log(`  ✓ Overlap: ${meta.overlapTokens} tokens`);
    console.log(`  ✓ Memories extracted: ${result.value.memories.length}`);
    
    console.log('\nCharacteristics:');
    console.log('  • Consistent chunk sizes');
    console.log('  • Predictable overlap');
    console.log('  • May split topics mid-discussion');
    console.log('  • Fast and reliable');
  }
}

/**
 * Demo 2: Conversation Boundary Strategy
 */
async function conversationBoundaryDemo() {
  console.log('\n' + '='.repeat(80));
  console.log('Demo 2: Conversation Boundary Strategy');
  console.log('='.repeat(80));
  console.log('\nBest for: Natural conversations with clear turn-taking');
  console.log('How it works: Splits at natural conversation breaks\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 5000,
      strategy: 'conversation-boundary',
      overlapTokens: 300,  // Smaller overlap at natural boundaries
      minChunkSize: 1000,  // Prevent tiny chunks
      failureMode: 'continue-on-error',
    },
  });

  const conversation = createTopicalConversation();
  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok && result.value.chunkingMetadata) {
    const meta = result.value.chunkingMetadata;
    
    console.log('Results:');
    console.log(`  ✓ Chunks created: ${meta.totalChunks}`);
    console.log(`  ✓ Chunk sizes: ${meta.chunkSizes.min} - ${meta.chunkSizes.max} tokens`);
    console.log(`  ✓ Average size: ${meta.chunkSizes.avg} tokens`);
    console.log(`  ✓ Size variance: ${(meta.chunkSizes.max - meta.chunkSizes.min)} tokens`);
    console.log(`  ✓ Memories extracted: ${result.value.memories.length}`);
    
    console.log('\nCharacteristics:');
    console.log('  • Variable chunk sizes');
    console.log('  • Respects conversation flow');
    console.log('  • Better context preservation');
    console.log('  • More natural boundaries');
  }
}

/**
 * Demo 3: Semantic Strategy
 */
async function semanticDemo() {
  console.log('\n' + '='.repeat(80));
  console.log('Demo 3: Semantic Strategy');
  console.log('='.repeat(80));
  console.log('\nBest for: Topic-focused conversations');
  console.log('How it works: Splits based on topic changes\n');

  const extractor = new MemoryExtractor({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
      model: 'gpt-4-turbo',
    }),
    strategy: new StructuredOutputStrategy(),
    
    chunking: {
      enabled: true,
      maxTokensPerChunk: 5000,
      strategy: 'semantic',
      overlapPercentage: 0.05,  // Smaller overlap since boundaries are semantic
      failureMode: 'continue-on-error',
    },
  });

  const conversation = createTopicalConversation();
  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok && result.value.chunkingMetadata) {
    const meta = result.value.chunkingMetadata;
    
    console.log('Results:');
    console.log(`  ✓ Chunks created: ${meta.totalChunks}`);
    console.log(`  ✓ Chunk sizes: ${meta.chunkSizes.min} - ${meta.chunkSizes.max} tokens`);
    console.log(`  ✓ Average size: ${meta.chunkSizes.avg} tokens`);
    console.log(`  ✓ Memories extracted: ${result.value.memories.length}`);
    
    console.log('\nCharacteristics:');
    console.log('  • Topic-coherent chunks');
    console.log('  • Intelligent boundaries');
    console.log('  • Fewer cross-chunk duplicates');
    console.log('  • Higher processing overhead');
    
    // Analyze topic distribution
    if (meta.chunks) {
      console.log('\nTopic Distribution:');
      meta.chunks.forEach((chunk, idx) => {
        console.log(`  Chunk ${idx + 1}: ${chunk.tokenCount} tokens, ${chunk.memories} memories`);
      });
    }
  }
}

/**
 * Demo 4: Side-by-Side Comparison
 */
async function comparisonDemo() {
  console.log('\n' + '='.repeat(80));
  console.log('Demo 4: Side-by-Side Comparison');
  console.log('='.repeat(80) + '\n');

  const conversation = createTopicalConversation();
  const strategies = [
    { name: 'Sliding Window', strategy: 'sliding-window' as const },
    { name: 'Conversation Boundary', strategy: 'conversation-boundary' as const },
    { name: 'Semantic', strategy: 'semantic' as const },
  ];

  console.log('Metric'.padEnd(25) + ' | ' + strategies.map(s => s.name.padEnd(20)).join(' | '));
  console.log('-'.repeat(90));

  const results = [];

  for (const { strategy } of strategies) {
    const extractor = new MemoryExtractor({
      provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
        model: 'gpt-4-turbo',
      }),
      strategy: new StructuredOutputStrategy(),
      
      chunking: {
        enabled: true,
        maxTokensPerChunk: 5000,
        strategy: strategy,
        overlapPercentage: 0.1,
        failureMode: 'continue-on-error',
      },
    });

    const startTime = Date.now();
    const result = await extractor.extract(conversation, 'workspace-1');
    const totalTime = Date.now() - startTime;

    results.push({
      strategy,
      result: result.ok ? result.value : null,
      time: totalTime,
    });
  }

  // Display comparison
  const metrics = [
    { label: 'Chunks Created', getValue: (r: any) => r.chunkingMetadata?.totalChunks || 0 },
    { label: 'Avg Chunk Size (tokens)', getValue: (r: any) => Math.round(r.chunkingMetadata?.averageTokensPerChunk || 0) },
    { label: 'Size Variance', getValue: (r: any) => {
      const meta = r.chunkingMetadata;
      return meta ? meta.chunkSizes.max - meta.chunkSizes.min : 0;
    }},
    { label: 'Memories Extracted', getValue: (r: any) => r.memories?.length || 0 },
    { label: 'Processing Time (ms)', getValue: (r: any, time: number) => time },
    { label: 'Chunking Time (ms)', getValue: (r: any) => r.chunkingMetadata?.processingTime.chunking || 0 },
  ];

  metrics.forEach(metric => {
    const values = results.map((r, idx) => {
      const value = metric.getValue(r.result, r.time);
      return value.toString().padEnd(20);
    });
    console.log(metric.label.padEnd(25) + ' | ' + values.join(' | '));
  });

  console.log('\nRecommendations:');
  console.log('  • Sliding Window: Default choice, most reliable');
  console.log('  • Conversation Boundary: Best for Q&A, support chats');
  console.log('  • Semantic: Best for technical docs, topic-focused content');
}

/**
 * Demo 5: Strategy Selection Guide
 */
function strategySelectionGuide() {
  console.log('\n' + '='.repeat(80));
  console.log('Demo 5: Strategy Selection Guide');
  console.log('='.repeat(80) + '\n');

  const guide = [
    {
      useCase: 'General Purpose',
      recommended: 'Sliding Window',
      reason: 'Predictable, reliable, works for all conversation types',
    },
    {
      useCase: 'Customer Support',
      recommended: 'Conversation Boundary',
      reason: 'Respects natural conversation flow and turn-taking',
    },
    {
      useCase: 'Technical Documentation',
      recommended: 'Semantic',
      reason: 'Maintains topic coherence, better for knowledge extraction',
    },
    {
      useCase: 'Interview Transcripts',
      recommended: 'Conversation Boundary',
      reason: 'Clear speaker turns, natural question-answer structure',
    },
    {
      useCase: 'Code Reviews',
      recommended: 'Semantic',
      reason: 'Groups related code discussions together',
    },
    {
      useCase: 'Meeting Notes',
      recommended: 'Semantic',
      reason: 'Splits by agenda items and topics',
    },
    {
      useCase: 'Chat Logs',
      recommended: 'Sliding Window',
      reason: 'Unpredictable structure, needs consistent handling',
    },
  ];

  console.log('Use Case'.padEnd(30) + ' | ' + 'Recommended Strategy'.padEnd(25) + ' | Reason');
  console.log('-'.repeat(100));

  guide.forEach(item => {
    console.log(
      item.useCase.padEnd(30) + ' | ' +
      item.recommended.padEnd(25) + ' | ' +
      item.reason
    );
  });

  console.log('\nConfiguration Tips:');
  console.log('  1. Start with sliding-window for reliability');
  console.log('  2. Test with your actual data before choosing');
  console.log('  3. Monitor chunk sizes and adjust maxTokensPerChunk');
  console.log('  4. Use 10% overlap for sliding-window, 5% for semantic');
  console.log('  5. Set minChunkSize to 20% of maxTokensPerChunk');
}

/**
 * Run all demos
 */
async function runAllDemos() {
  console.log('\n' + '='.repeat(80));
  console.log('Chunking Strategies Demonstration');
  console.log('='.repeat(80));

  try {
    await slidingWindowDemo();
    await conversationBoundaryDemo();
    await semanticDemo();
    await comparisonDemo();
    strategySelectionGuide();

    console.log('\n' + '='.repeat(80));
    console.log('All demos completed!');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('Error running demos:', error);
  }
}

// Run demos if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllDemos().catch(console.error);
}

export {
  createTopicalConversation,
  slidingWindowDemo,
  conversationBoundaryDemo,
  semanticDemo,
  comparisonDemo,
  strategySelectionGuide,
};
