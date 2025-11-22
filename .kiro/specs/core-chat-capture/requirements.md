# Requirements Document

## Introduction

The Chat Capture module provides a unified interface for ingesting chat conversations from different AI providers (ChatGPT, Claude, etc.). It normalizes provider-specific formats into a consistent data structure that can be stored and processed by MemoryLayer. This module must handle both file imports (JSON exports) and real-time API captures.

## Glossary

- **Chat Capture**: The module that ingests and normalizes chat data from AI providers
- **Provider**: An AI service (OpenAI, Anthropic, etc.) that generates conversations
- **Normalized Conversation**: A standardized conversation format used internally by MemoryLayer
- **Parser**: A provider-specific component that converts raw chat data to normalized format
- **Message**: A single turn in a conversation (user or assistant)

## Requirements

### Requirement 1

**User Story:** As a developer building on MemoryLayer, I want to ingest ChatGPT conversation exports, so that users can import their existing chat history.

#### Acceptance Criteria

1. THE Chat Capture SHALL parse ChatGPT JSON export files into normalized conversation format
2. THE Chat Capture SHALL extract conversation metadata (title, creation date, provider)
3. THE Chat Capture SHALL extract all messages with role (user/assistant/system) and content
4. THE Chat Capture SHALL preserve message ordering and timestamps
5. THE Chat Capture SHALL handle multi-turn conversations with arbitrary length
6. THE Chat Capture SHALL support files that contain multiple conversations and return a list of NormalizedConversation objects
7. THE Chat Capture SHALL preserve message content exactly as provided, including code blocks, markdown, and formatting

### Requirement 2

**User Story:** As a developer, I want to ingest Claude conversation exports, so that users can import conversations from Anthropic's Claude.

#### Acceptance Criteria

1. THE Chat Capture SHALL parse Claude conversation export format into normalized format
2. THE Chat Capture SHALL map Claude-specific message roles to standard roles
3. THE Chat Capture SHALL extract conversation metadata from Claude exports
4. THE Chat Capture SHALL handle Claude's conversation structure and formatting
5. THE Chat Capture SHALL preserve all message content including code blocks and formatting

### Requirement 3

**User Story:** As a developer, I want a unified conversation format, so that downstream modules don't need provider-specific logic.

#### Acceptance Criteria

1. THE Chat Capture SHALL define a NormalizedConversation type with id, provider, external_id, title, created_at, updated_at, messages array, and raw_metadata
2. THE Chat Capture SHALL define a NormalizedMessage type with id, role, content, and created_at
3. THE Chat Capture SHALL normalize timestamps to ISO 8601 format
4. THE Chat Capture SHALL normalize message roles to 'user', 'assistant', or 'system'
5. THE Chat Capture SHALL include raw_metadata for provider-specific fields that don't map to standard fields

### Requirement 4

**User Story:** As a developer, I want extensible parser registration, so that new AI providers can be added without modifying core code.

#### Acceptance Criteria

1. THE Chat Capture SHALL provide a parser registry for registering provider parsers
2. THE Chat Capture SHALL allow runtime registration of new parsers
3. THE Chat Capture SHALL select the appropriate parser based on explicit provider identifier
4. THE Chat Capture MAY support automatic provider detection for common export formats
5. WHERE a provider is not registered and cannot be detected, THE Chat Capture SHALL return a clear error
6. THE Chat Capture SHALL support custom parsers for proprietary AI systems

### Requirement 5

**User Story:** As a developer, I want validation of imported conversations, so that malformed data is rejected early.

#### Acceptance Criteria

1. THE Chat Capture SHALL validate that conversations have at least one message
2. THE Chat Capture SHALL validate that all messages have required fields (role, content)
3. THE Chat Capture SHALL validate that timestamps are valid dates
4. IF validation fails, THEN THE Chat Capture SHALL return a detailed validation error with conversation identifier
5. THE Chat Capture SHALL validate provider-specific required fields before normalization
6. WHEN importing multiple conversations, THE Chat Capture SHALL clearly mark which conversations failed validation
7. THE Chat Capture SHALL enforce configurable limits on file size and number of conversations per import

### Requirement 6

**User Story:** As a developer, I want to capture conversations from live API calls, so that real-time chat can be stored.

#### Acceptance Criteria

1. THE Chat Capture SHALL accept streaming message data from API responses
2. THE Chat Capture SHALL accept a conversation identifier for streaming sessions
3. THE Chat Capture SHALL build conversations incrementally as messages arrive
4. THE Chat Capture SHALL handle partial messages and completion events
5. THE Chat Capture SHALL emit a completion event indicating when a streamed conversation is finalized
6. THE Chat Capture SHALL normalize streaming data to the same format as file imports
7. THE Chat Capture SHALL support both OpenAI and Anthropic streaming formats

### Requirement 7

**User Story:** As a developer, I want error handling for malformed imports, so that users get clear feedback on import failures.

#### Acceptance Criteria

1. THE Chat Capture SHALL return typed errors for parsing failures
2. THE Chat Capture SHALL distinguish between validation errors and parsing errors
3. WHEN a file cannot be parsed, THE Chat Capture SHALL include the provider and error location
4. THE Chat Capture SHALL handle corrupted JSON gracefully without crashing
5. THE Chat Capture SHALL log parsing errors with sufficient context for debugging