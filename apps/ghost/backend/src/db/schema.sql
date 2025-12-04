-- Ghost SQLite Database Schema with MemoryLayer Integration

-- ============================================================================
-- MemoryLayer Tables (for sophisticated memory system)
-- ============================================================================

-- Users table: single default user for Ghost
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workspaces table: single default workspace for Ghost
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('personal', 'team')),
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Conversations table: tracks conversation history
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Memories table: stores extracted memories with embeddings
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    metadata TEXT NOT NULL DEFAULT '{}', -- JSON
    embedding TEXT, -- JSON array of numbers (384-dim vector)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- Relationships table: tracks connections between memories
CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    from_memory_id TEXT NOT NULL,
    to_memory_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- ============================================================================
-- Ghost-specific Tables (for command tracking)
-- ============================================================================

-- Commands table: stores all voice/text commands and responses
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    assistant_text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

-- Actions table: stores actions generated from commands
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL,
    type TEXT NOT NULL,
    params TEXT NOT NULL, -- JSON
    status TEXT NOT NULL DEFAULT 'pending',
    executed_at TEXT,
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
);

-- Command-Memory junction table: tracks which memories were used for each command
CREATE TABLE IF NOT EXISTS command_memories (
    command_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    score REAL NOT NULL,
    PRIMARY KEY (command_id, memory_id),
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE,
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Workspace indexes
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces(owner_id);

-- Conversation indexes
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- Memory indexes
CREATE INDEX IF NOT EXISTS idx_memories_workspace_id ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_conversation_id ON memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);

-- Relationship indexes
CREATE INDEX IF NOT EXISTS idx_relationships_from_memory ON relationships(from_memory_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to_memory ON relationships(to_memory_id);

-- Command indexes
CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_commands_user_id ON commands(user_id);
CREATE INDEX IF NOT EXISTS idx_commands_workspace_id ON commands(workspace_id);

-- Action indexes
CREATE INDEX IF NOT EXISTS idx_actions_command_id ON actions(command_id);

-- Command-Memory junction indexes
CREATE INDEX IF NOT EXISTS idx_command_memories_command_id ON command_memories(command_id);
CREATE INDEX IF NOT EXISTS idx_command_memories_memory_id ON command_memories(memory_id);

-- ============================================================================
-- Explainability Tables
-- ============================================================================

-- Explanation Contexts table: stores detailed reasoning and graph data for commands
CREATE TABLE IF NOT EXISTS explanation_contexts (
    command_id TEXT PRIMARY KEY,
    command_text TEXT NOT NULL,
    user_query TEXT NOT NULL,
    reasoning_data TEXT NOT NULL, -- JSON
    graph_data TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
);

-- Explanation Context indexes
CREATE INDEX IF NOT EXISTS idx_explanation_contexts_created_at ON explanation_contexts(created_at DESC);
