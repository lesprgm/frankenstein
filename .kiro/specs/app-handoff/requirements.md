# Requirements Document

## Introduction

Handoff is an AI memory application that maintains context across different AI providers, supporting both personal and team workspaces. It uses the MemoryLayer skeleton to import conversations from ChatGPT, Claude, and other AI assistants, extract memories, and provide context-aware chat with full recall of past discussions. The application demonstrates how the same skeleton can be configured for individual use (personal workspaces) and collaborative use (team workspaces).

## Glossary

- **Handoff**: The AI memory application supporting personal and team workspaces
- **Personal Workspace**: A single-user workspace containing a user's private conversations and memories
- **Team Workspace**: A multi-user workspace where conversations and memories are shared among team members
- **Workspace Switcher**: UI component for switching between different workspaces
- **Import**: The process of uploading and processing chat export files
- **Memory Timeline**: A chronological view of extracted memories
- **Context-Aware Chat**: Chat interface that injects relevant memories into AI prompts
- **Attribution**: Tracking which user imported conversations or contributed to team knowledge

## Requirements

### Requirement 1

**User Story:** As a user, I want to sign up and have a personal workspace created automatically, so that I can start importing my conversations immediately.

#### Acceptance Criteria

1. THE Handoff application SHALL provide email-based authentication
2. WHEN a user signs up, THE Handoff application SHALL create a personal workspace with type 'personal'
3. THE Handoff application SHALL name the workspace after the user
4. THE Handoff application SHALL set the user as the workspace owner
5. THE Handoff application SHALL redirect the user to the import page after signup

### Requirement 2

**User Story:** As a user, I want to import my ChatGPT conversation history, so that Handoff can learn from my past interactions.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a file upload interface for chat exports
2. THE Handoff application SHALL accept JSON files up to 50MB
3. THE Handoff application SHALL auto-detect the provider (ChatGPT, Claude) from file structure
4. THE Handoff application SHALL parse and store all conversations in the currently selected workspace
5. WHEN a user first signs up, THE Handoff application SHALL default to the user's personal workspace
6. THE Handoff application SHALL display import progress and results
7. THE Handoff application SHALL handle import errors gracefully with clear error messages

### Requirement 3

**User Story:** As a user, I want my imported conversations to be automatically analyzed for memories, so that I don't have to manually tag or organize information.

#### Acceptance Criteria

1. WHEN conversations are imported, THE Handoff application SHALL automatically trigger memory extraction
2. THE Handoff application SHALL extract entities, facts, and decisions from conversations
3. THE Handoff application SHALL use workspace-appropriate extraction profiles (personal_default for personal workspaces, team_default for team workspaces)
4. THE Handoff application SHALL display extraction progress to the user
5. THE Handoff application SHALL notify the user when extraction is complete

### Requirement 4

**User Story:** As a user, I want to browse my extracted memories in a timeline view, so that I can see what Handoff has learned about me.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a memory timeline view
2. THE Handoff application SHALL display memories in reverse chronological order
3. THE Handoff application SHALL show memory type, content, confidence, and timestamp
4. THE Handoff application SHALL allow filtering by memory type (entity, fact, decision)
5. THE Handoff application SHALL allow searching memories by content
6. THE Handoff application SHALL link memories to their source conversations

### Requirement 5

**User Story:** As a user, I want to chat with an AI that remembers my past conversations, so that I don't have to repeat context.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a chat interface
2. WHEN a user sends a message, THE Handoff application SHALL search for relevant memories
3. THE Handoff application SHALL inject relevant memories into the AI prompt
4. THE Handoff application SHALL display which memories are being used for context
5. THE Handoff application SHALL extract new memories from chat conversations
6. THE Handoff application SHALL use a token budget of 1500 for context injection

### Requirement 6

**User Story:** As a user, I want to see which memories are being used in my chat, so that I understand what context the AI has.

#### Acceptance Criteria

1. THE Handoff application SHALL display a context panel in the chat interface
2. THE Handoff application SHALL show the memories used for each AI response
3. THE Handoff application SHALL display memory type, content, and relevance score
4. THE Handoff application SHALL allow clicking a memory to see its source conversation
5. THE Handoff application SHALL indicate when context budget is exceeded

### Requirement 7

**User Story:** As a user, I want to view my imported conversations, so that I can reference past discussions.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a conversations list view
2. THE Handoff application SHALL display conversation title, provider, and date
3. THE Handoff application SHALL allow filtering by provider
4. THE Handoff application SHALL allow searching conversations by content
5. THE Handoff application SHALL display full conversation when clicked
6. THE Handoff application SHALL show which memories were extracted from each conversation

### Requirement 8

**User Story:** As a user, I want to delete my data, so that I can remove my information if I stop using Handoff.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a settings page
2. THE Handoff application SHALL allow users to delete their workspace
3. WHEN a workspace is deleted, THE Handoff application SHALL remove all conversations, memories, and relationships
4. THE Handoff application SHALL require confirmation before deletion
5. THE Handoff application SHALL allow users to export their data before deletion

### Requirement 9

**User Story:** As a user, I want to export my data, so that I can back it up or use it elsewhere.

#### Acceptance Criteria

1. THE Handoff application SHALL provide a data export feature
2. THE Handoff application SHALL export all conversations in JSON format
3. THE Handoff application SHALL export all memories in JSON format
4. THE Handoff application SHALL include relationships in the export
5. THE Handoff application SHALL provide a downloadable ZIP file

### Requirement 10

**User Story:** As a user, I want to switch between my personal workspace and team workspaces, so that my memories stay separated by context.

#### Acceptance Criteria

1. THE Handoff application SHALL support multiple workspaces per user
2. THE Handoff application SHALL provide a workspace switcher in the main UI
3. WHEN the user switches workspace, THE Handoff application SHALL update all views to show data for that workspace only
4. THE Handoff application SHALL display the current workspace name in the header
5. THE Handoff application SHALL remember the last selected workspace across sessions

### Requirement 11

**User Story:** As a user, I want to create a team workspace, so that my teammates and I can share conversations and memories.

#### Acceptance Criteria

1. THE Handoff application SHALL allow users to create new workspaces with type 'team'
2. THE Handoff application SHALL allow naming team workspaces
3. THE Handoff application SHALL allow adding team members by email
4. THE Handoff application SHALL treat all members of a team workspace as having access to that workspace's data
5. THE Handoff application SHALL display team member list in workspace settings

### Requirement 12

**User Story:** As a user, I want chat and memory extraction to stay within the selected workspace, so that my personal and team information never mix.

#### Acceptance Criteria

1. WHEN importing conversations, THE Handoff application SHALL store them in the currently selected workspace
2. WHEN extracting memories, THE Handoff application SHALL tag them with the current workspace_id
3. WHEN using chat, THE Handoff application SHALL search only memories from the currently selected workspace
4. THE Handoff application SHALL prevent cross-workspace data access
5. THE Handoff application SHALL use workspace-appropriate extraction profiles (personal_default vs team_default)

### Requirement 13

**User Story:** As a user in a team workspace, I want to see who imported conversations and contributed memories, so that I know the source of team knowledge.

#### Acceptance Criteria

1. THE Handoff application SHALL display the importing user's name on conversations in team workspaces
2. THE Handoff application SHALL show attribution in memory views for team workspaces
3. THE Handoff application SHALL hide attribution in personal workspaces
4. THE Handoff application SHALL display a team activity feed showing recent imports and extractions
5. THE Handoff application SHALL allow filtering activity by team member

### Requirement 14

**User Story:** As a user, I want the application to be fast and responsive, so that I can work efficiently.

#### Acceptance Criteria

1. THE Handoff application SHALL load the main interface in under 2 seconds
2. THE Handoff application SHALL respond to chat messages in under 5 seconds
3. THE Handoff application SHALL display import progress in real-time
4. THE Handoff application SHALL use optimistic UI updates where possible
5. THE Handoff application SHALL cache frequently accessed data
