/**
 * Example: Using Extraction Profiles
 * 
 * This example demonstrates how to register and use extraction profiles
 * to configure memory extraction behavior.
 */

import {
  MemoryExtractor,
  OpenAIProvider,
  StructuredOutputStrategy,
  ExtractionProfile,
  NormalizedConversation,
} from '../src/index.js';

// Example conversation
const conversation: NormalizedConversation = {
  id: 'conv-123',
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: 'I work at Acme Corp as a software engineer. We are building a new AI product.',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'That sounds exciting! What kind of AI product are you building?',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'msg-3',
      role: 'user',
      content: 'We decided to focus on natural language processing for customer support.',
      timestamp: new Date().toISOString(),
    },
  ],
};

async function demonstrateProfiles() {
  // Initialize provider and strategy
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || 'test-key',
  });

  const strategy = new StructuredOutputStrategy();

  // Create extractor
  const extractor = new MemoryExtractor({
    provider,
    strategy,
    memoryTypes: ['entity', 'fact', 'decision'],
    minConfidence: 0.5,
  });

  // Register a "high-precision" profile
  const highPrecisionProfile: ExtractionProfile = {
    strategy,
    provider,
    modelParams: {
      model: 'gpt-4o',
      temperature: 0.0,
      maxTokens: 4000,
    },
    memoryTypes: ['entity', 'fact', 'decision'],
    minConfidence: 0.8, // Higher confidence threshold
  };

  extractor.registerProfile('high-precision', highPrecisionProfile);
  console.log('✓ Registered "high-precision" profile');

  // Register a "fast" profile
  const fastProfile: ExtractionProfile = {
    strategy,
    provider,
    modelParams: {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 2000,
    },
    memoryTypes: ['entity', 'fact'], // Only extract entities and facts
    minConfidence: 0.6,
  };

  extractor.registerProfile('fast', fastProfile);
  console.log('✓ Registered "fast" profile');

  // Register a "comprehensive" profile
  const comprehensiveProfile: ExtractionProfile = {
    strategy,
    provider,
    modelParams: {
      model: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 8000,
    },
    memoryTypes: ['entity', 'fact', 'decision'],
    minConfidence: 0.4, // Lower threshold to capture more
  };

  extractor.registerProfile('comprehensive', comprehensiveProfile);
  console.log('✓ Registered "comprehensive" profile');

  console.log('\n--- Extraction with Default Config ---');
  const defaultResult = await extractor.extract(
    conversation,
    'workspace-123'
  );

  if (defaultResult.ok) {
    console.log(`Status: ${defaultResult.value.status}`);
    console.log(`Memories: ${defaultResult.value.memories.length}`);
    console.log(`Relationships: ${defaultResult.value.relationships.length}`);
  }

  console.log('\n--- Extraction with "high-precision" Profile ---');
  const highPrecisionResult = await extractor.extract(
    conversation,
    'workspace-123',
    { profile: 'high-precision' }
  );

  if (highPrecisionResult.ok) {
    console.log(`Status: ${highPrecisionResult.value.status}`);
    console.log(`Memories: ${highPrecisionResult.value.memories.length}`);
    console.log(`Relationships: ${highPrecisionResult.value.relationships.length}`);
    console.log('Note: Higher confidence threshold (0.8) filters out low-confidence memories');
  }

  console.log('\n--- Extraction with "fast" Profile ---');
  const fastResult = await extractor.extract(
    conversation,
    'workspace-123',
    { profile: 'fast' }
  );

  if (fastResult.ok) {
    console.log(`Status: ${fastResult.value.status}`);
    console.log(`Memories: ${fastResult.value.memories.length}`);
    console.log(`Relationships: ${fastResult.value.relationships.length}`);
    console.log('Note: Only extracts entities and facts (no decisions)');
  }

  console.log('\n--- Extraction with "comprehensive" Profile ---');
  const comprehensiveResult = await extractor.extract(
    conversation,
    'workspace-123',
    { profile: 'comprehensive' }
  );

  if (comprehensiveResult.ok) {
    console.log(`Status: ${comprehensiveResult.value.status}`);
    console.log(`Memories: ${comprehensiveResult.value.memories.length}`);
    console.log(`Relationships: ${comprehensiveResult.value.relationships.length}`);
    console.log('Note: Lower confidence threshold (0.4) captures more memories');
  }

  console.log('\n--- Profile Override with Options ---');
  const overrideResult = await extractor.extract(
    conversation,
    'workspace-123',
    {
      profile: 'fast',
      memoryTypes: ['entity'], // Override profile's memory types
      minConfidence: 0.7,      // Override profile's confidence threshold
    }
  );

  if (overrideResult.ok) {
    console.log(`Status: ${overrideResult.value.status}`);
    console.log(`Memories: ${overrideResult.value.memories.length}`);
    console.log('Note: Options override profile settings');
  }
}

// Run the example
demonstrateProfiles().catch(console.error);
