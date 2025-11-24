/**
 * Example: Using Custom Memory Types
 * 
 * This example demonstrates how to register and use custom memory types
 * with the MemoryExtractor.
 */

import { MemoryExtractor } from '../src/index.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { StructuredOutputStrategy } from '../src/strategies/structured.js';
import { MemoryTypeConfig } from '../src/types.js';

// Initialize the extractor with default configuration
const extractor = new MemoryExtractor({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key'
  }),
  strategy: new StructuredOutputStrategy(),
  memoryTypes: ['entity', 'fact', 'task', 'preference'], // Include custom types
  minConfidence: 0.6
});

// Example 1: Register a custom "task" memory type
const taskConfig: MemoryTypeConfig = {
  type: 'task',
  extractionPrompt: `Extract action items and tasks mentioned in the conversation.

For each task, provide:
- task: The task description
- assignee: Who is responsible (if mentioned)
- dueDate: When it's due (if mentioned)
- priority: Priority level (low, medium, high)
- status: Current status (todo, in_progress, done)

Focus on tasks that are:
- Explicitly stated or clearly implied
- Actionable items with clear outcomes
- Relevant for tracking and follow-up

Assign confidence scores based on:
- How explicitly the task is stated (0.9-1.0 for clear tasks)
- Whether assignee and deadline are mentioned (0.7-0.9 for partial info)
- How actionable the item is (0.5-0.7 for vague items)`,
  schema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The task description'
      },
      assignee: {
        type: 'string',
        description: 'Person responsible for the task'
      },
      dueDate: {
        type: 'string',
        description: 'Due date in ISO format'
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Task priority'
      },
      status: {
        type: 'string',
        enum: ['todo', 'in_progress', 'done'],
        description: 'Current status'
      }
    },
    required: ['task']
  },
  validator: (memory) => {
    // Custom validation: task description must be at least 10 characters
    return memory.metadata.task && memory.metadata.task.length >= 10;
  }
};

extractor.registerMemoryType('task', taskConfig);

// Example 2: Register a custom "preference" memory type
const preferenceConfig: MemoryTypeConfig = {
  type: 'preference',
  extractionPrompt: `Extract user preferences and settings mentioned in the conversation.

For each preference, provide:
- preference: The preference category (e.g., 'theme', 'language', 'notifications')
- value: The preferred value
- context: Additional context about the preference

Focus on preferences that are:
- Explicitly stated by the user
- Related to system settings or user choices
- Likely to affect future interactions

Assign confidence scores based on:
- How explicitly stated (0.9-1.0 for "I prefer...")
- How specific the preference is (0.7-0.9 for general preferences)
- Whether it's a one-time mention or repeated (0.5-0.7 for casual mentions)`,
  schema: {
    type: 'object',
    properties: {
      preference: {
        type: 'string',
        description: 'The preference category'
      },
      value: {
        type: 'string',
        description: 'The preferred value'
      },
      context: {
        type: 'string',
        description: 'Additional context'
      }
    },
    required: ['preference', 'value']
  }
};

extractor.registerMemoryType('preference', preferenceConfig);

// Example 3: Register a custom "bug" memory type for software development
const bugConfig: MemoryTypeConfig = {
  type: 'bug',
  extractionPrompt: `Extract bug reports and issues mentioned in the conversation.

For each bug, provide:
- description: What the bug is
- severity: How severe (critical, major, minor)
- component: Which component is affected
- reproducible: Whether it can be reproduced

Focus on bugs that are:
- Clearly described problems or errors
- Have enough detail to investigate
- Are actual bugs, not feature requests`,
  schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      severity: {
        type: 'string',
        enum: ['critical', 'major', 'minor']
      },
      component: { type: 'string' },
      reproducible: { type: 'boolean' }
    },
    required: ['description']
  }
};

extractor.registerMemoryType('bug', bugConfig);

// Example usage: Extract memories from a conversation
async function extractWithCustomTypes() {
  const conversation = {
    id: 'conv-123',
    messages: [
      {
        id: 'msg-1',
        role: 'user' as const,
        content: 'We need to implement user authentication by end of Q1. Can you assign this to Sarah?',
        timestamp: '2024-01-15T10:00:00Z'
      },
      {
        id: 'msg-2',
        role: 'assistant' as const,
        content: 'I\'ll create a task for Sarah to implement user authentication by March 31st.',
        timestamp: '2024-01-15T10:01:00Z'
      },
      {
        id: 'msg-3',
        role: 'user' as const,
        content: 'Also, I prefer dark mode for the interface.',
        timestamp: '2024-01-15T10:02:00Z'
      },
      {
        id: 'msg-4',
        role: 'user' as const,
        content: 'There\'s a critical bug in the login page - users can\'t reset their passwords.',
        timestamp: '2024-01-15T10:03:00Z'
      }
    ]
  };

  const result = await extractor.extract(conversation, 'workspace-1');

  if (result.ok) {
    console.log('Extraction successful!');
    console.log(`Total memories: ${result.value.memories.length}`);
    
    // Filter by custom memory types
    const tasks = result.value.memories.filter(m => m.type === 'task');
    const preferences = result.value.memories.filter(m => m.type === 'preference');
    const bugs = result.value.memories.filter(m => m.type === 'bug');
    
    console.log('\nTasks:', tasks.length);
    tasks.forEach(task => {
      console.log(`  - ${task.content}`);
      console.log(`    Assignee: ${task.metadata.assignee || 'unassigned'}`);
      console.log(`    Due: ${task.metadata.dueDate || 'no deadline'}`);
      console.log(`    Confidence: ${task.confidence}`);
    });
    
    console.log('\nPreferences:', preferences.length);
    preferences.forEach(pref => {
      console.log(`  - ${pref.metadata.preference}: ${pref.metadata.value}`);
      console.log(`    Confidence: ${pref.confidence}`);
    });
    
    console.log('\nBugs:', bugs.length);
    bugs.forEach(bug => {
      console.log(`  - ${bug.content}`);
      console.log(`    Severity: ${bug.metadata.severity || 'unknown'}`);
      console.log(`    Confidence: ${bug.confidence}`);
    });
  } else {
    console.error('Extraction failed:', result.error);
  }
}

// Run the example (uncomment to execute)
// extractWithCustomTypes().catch(console.error);

export { taskConfig, preferenceConfig, bugConfig };
