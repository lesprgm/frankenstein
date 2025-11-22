# Implementation Plan

- [x] 1. Set up project structure and core types
  - Create `packages/core/chat-capture/` directory with package.json and tsconfig.json
  - Define NormalizedConversation and NormalizedMessage interfaces in `src/types.ts`
  - Define CaptureError type and Result type in `src/errors.ts`
  - Define ChatCaptureConfig and ParseOptions interfaces in `src/types.ts`
  - _Requirements: 3.1, 3.2, 7.1, 7.2_

- [x] 2. Implement BaseParser and ParserRegistry
  - Create `src/parsers/base.ts` with BaseParser abstract class
  - Implement ConversationParser interface
  - Add helper methods: generateId(), normalizeTimestamp(), normalizeRole()
  - Create `src/registry.ts` with ParserRegistry class
  - Implement register(), get(), detect(), and listProviders() methods
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

- [x] 3. Implement OpenAI parser
  - Create `src/parsers/openai.ts` with OpenAIParser class extending BaseParser
  - Implement canParse() to detect ChatGPT export structure
  - Implement parse() to handle single and multi-conversation exports
  - Extract conversation metadata (title, timestamps, external_id)
  - Parse message mapping structure and extract all messages
  - Normalize message roles and preserve content formatting
  - Handle code blocks and markdown preservation
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.3, 3.4_

- [x] 4. Implement Anthropic parser
  - Create `src/parsers/anthropic.ts` with AnthropicParser class extending BaseParser
  - Implement canParse() to detect Claude export structure
  - Implement parse() to handle Claude conversation format
  - Map Claude-specific message roles to standard roles
  - Extract conversation metadata from Claude exports
  - Preserve all message content including formatting
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.3, 3.4_

- [x] 5. Implement auto-detection logic
  - Create `src/parsers/detector.ts` with detection utilities
  - Implement logic to try each parser's canParse() method
  - Return first matching parser or error if none match
  - Add detection based on structural patterns (field names, nesting)
  - _Requirements: 4.4, 4.5_

- [x] 6. Implement ConversationValidator
  - Create `src/validator.ts` with ConversationValidator class
  - Implement validate() for single conversation validation
  - Check for at least one message
  - Validate all messages have required fields (role, content)
  - Validate timestamps are valid ISO 8601 dates
  - Implement validateBatch() for multiple conversations
  - Return detailed validation errors with conversation and message identifiers
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Implement ChatCapture main class
  - Create `src/index.ts` with ChatCapture class
  - Implement constructor that initializes ParserRegistry and config
  - Register default parsers (OpenAI, Anthropic) in constructor
  - Implement parseFile() with explicit provider parameter
  - Implement parseFileAuto() with auto-detection
  - Implement registerParser() for custom parser registration
  - Add file size validation before parsing
  - Add conversation count validation after parsing
  - Integrate validator for all parsed conversations
  - Handle skipInvalid option for partial failure scenarios
  - _Requirements: 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.6, 5.7, 7.3, 7.4_

- [x] 8. Implement StreamingConversationBuilder
  - Create `src/streaming.ts` with StreamingConversationBuilder class
  - Implement constructor that accepts provider, conversationId, and parser
  - Implement addChunk() to handle incremental message assembly
  - Track current message state and append content deltas
  - Implement addMessage() for complete message addition
  - Implement finalize() to create final NormalizedConversation
  - Implement getState() for debugging current builder state
  - Handle both OpenAI and Anthropic streaming formats
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 9. Implement createStreamingBuilder in ChatCapture
  - Add createStreamingBuilder() method to ChatCapture class
  - Validate provider is registered
  - Create and return StreamingConversationBuilder instance
  - Return error if provider not found
  - _Requirements: 6.1, 6.2, 4.5_

- [x] 10. Implement error handling and logging
  - Ensure all methods return Result<T, CaptureError> types
  - Add logging for parsing failures with provider and error context
  - Log validation errors with conversation identifiers
  - Handle corrupted JSON gracefully without crashing
  - Add context to all error messages (provider, file location, etc.)
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 11. Write unit tests for parsers
  - Test OpenAIParser with real ChatGPT export samples
  - Test AnthropicParser with real Claude export samples
  - Test canParse() detection for each parser
  - Test multi-conversation file handling
  - Test formatting preservation (code blocks, markdown)
  - Test malformed data handling
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 12. Write unit tests for validation
  - Test validation with valid conversations
  - Test validation with missing required fields
  - Test validation with invalid timestamps
  - Test validation with empty message arrays
  - Test batch validation with mixed valid/invalid conversations
  - Test validation error messages include proper identifiers
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 13. Write unit tests for streaming builder
  - Test incremental message assembly with chunks
  - Test addMessage() for complete messages
  - Test finalize() creates proper NormalizedConversation
  - Test getState() returns accurate state
  - Test both OpenAI and Anthropic streaming formats
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 14. Write integration tests for ChatCapture
  - Test end-to-end file import with multi-conversation exports
  - Test auto-detection with various file formats
  - Test custom parser registration and usage
  - Test file size limit enforcement
  - Test conversation count limit enforcement
  - Test skipInvalid mode with partial failures
  - Test streaming capture with simulated API responses
  - _Requirements: 1.6, 4.4, 4.6, 5.6, 5.7, 6.1, 6.6_
