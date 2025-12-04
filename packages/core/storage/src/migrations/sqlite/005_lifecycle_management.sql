-- Memory Lifecycle Management Migration for SQLite
-- Adds lifecycle columns, archived_memories table, and lifecycle_events table

-- Add lifecycle columns to memories table
-- Note: SQLite ALTER TABLE doesn't support CHECK constraints, so we add them without constraints
-- The application layer will enforce these constraints
ALTER TABLE memories ADD COLUMN lifecycle_state TEXT DEFAULT 'active';
ALTER TABLE memories ADD COLUMN last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN importance_score REAL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN decay_score REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN effective_ttl INTEGER; -- milliseconds
ALTER TABLE memories ADD COLUMN pinned INTEGER DEFAULT 0; -- SQLite boolean (0=false, 1=true)
ALTER TABLE memories ADD COLUMN pinned_by TEXT;
ALTER TABLE memories ADD COLUMN pinned_at TIMESTAMP;
ALTER TABLE memories ADD COLUMN archived_at TIMESTAMP;
ALTER TABLE memories ADD COLUMN expires_at TIMESTAMP;

-- Create indexes for lifecycle queries
CREATE INDEX IF NOT EXISTS idx_memories_lifecycle_state ON memories(workspace_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(workspace_id, last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(workspace_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(workspace_id, pinned) WHERE pinned = 1;

-- Create archived_memories table for cold storage
CREATE TABLE IF NOT EXISTS archived_memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  last_accessed_at TIMESTAMP NOT NULL,
  access_count INTEGER NOT NULL,
  importance_score REAL NOT NULL,
  archived_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (importance_score >= 0 AND importance_score <= 1)
);

CREATE INDEX IF NOT EXISTS idx_archived_memories_workspace ON archived_memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_archived_memories_expires_at ON archived_memories(workspace_id, expires_at) WHERE expires_at IS NOT NULL;

-- Create lifecycle_events table for audit trail
CREATE TABLE IF NOT EXISTS lifecycle_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  memory_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  user_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (previous_state IN ('active', 'decaying', 'archived', 'expired', 'pinned')),
  CHECK (new_state IN ('active', 'decaying', 'archived', 'expired', 'pinned')),
  CHECK (triggered_by IN ('system', 'user'))
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_memory ON lifecycle_events(memory_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_workspace ON lifecycle_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_created_at ON lifecycle_events(created_at);

-- Initialize default values for existing memories
-- Set last_accessed_at to created_at for existing memories
UPDATE memories SET last_accessed_at = created_at WHERE last_accessed_at IS NULL;
