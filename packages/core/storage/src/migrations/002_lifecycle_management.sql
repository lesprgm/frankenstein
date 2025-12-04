-- Memory Lifecycle Management Migration for Postgres
-- Adds lifecycle columns, archived_memories table, and lifecycle_events table

-- UP MIGRATION

-- Add lifecycle columns to memories table
ALTER TABLE memories ADD COLUMN lifecycle_state VARCHAR(20) DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'decaying', 'archived', 'expired', 'pinned'));
ALTER TABLE memories ADD COLUMN last_accessed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN importance_score REAL DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1);
ALTER TABLE memories ADD COLUMN decay_score REAL DEFAULT 1.0 CHECK (decay_score >= 0 AND decay_score <= 1);
ALTER TABLE memories ADD COLUMN effective_ttl BIGINT; -- milliseconds
ALTER TABLE memories ADD COLUMN pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN pinned_by VARCHAR(255);
ALTER TABLE memories ADD COLUMN pinned_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN expires_at TIMESTAMPTZ;

-- Create indexes for lifecycle queries
CREATE INDEX idx_memories_lifecycle_state ON memories(workspace_id, lifecycle_state);
CREATE INDEX idx_memories_last_accessed ON memories(workspace_id, last_accessed_at);
CREATE INDEX idx_memories_expires_at ON memories(workspace_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_memories_pinned ON memories(workspace_id, pinned) WHERE pinned = TRUE;

-- Create archived_memories table for cold storage
CREATE TABLE archived_memories (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ NOT NULL,
  access_count INTEGER NOT NULL,
  importance_score REAL NOT NULL CHECK (importance_score >= 0 AND importance_score <= 1),
  archived_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_archived_memories_workspace ON archived_memories(workspace_id);
CREATE INDEX idx_archived_memories_expires_at ON archived_memories(workspace_id, expires_at) WHERE expires_at IS NOT NULL;

-- Create lifecycle_events table for audit trail
CREATE TABLE lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  previous_state VARCHAR(20) NOT NULL CHECK (previous_state IN ('active', 'decaying', 'archived', 'expired', 'pinned')),
  new_state VARCHAR(20) NOT NULL CHECK (new_state IN ('active', 'decaying', 'archived', 'expired', 'pinned')),
  reason TEXT NOT NULL,
  triggered_by VARCHAR(10) NOT NULL CHECK (triggered_by IN ('system', 'user')),
  user_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_events_memory ON lifecycle_events(memory_id);
CREATE INDEX idx_lifecycle_events_workspace ON lifecycle_events(workspace_id, created_at DESC);
CREATE INDEX idx_lifecycle_events_created_at ON lifecycle_events(created_at);

-- Initialize default values for existing memories
-- Set last_accessed_at to created_at for existing memories
UPDATE memories SET last_accessed_at = created_at WHERE last_accessed_at IS NULL;

-- DOWN MIGRATION

-- Drop lifecycle_events table
DROP TABLE IF EXISTS lifecycle_events CASCADE;

-- Drop archived_memories table
DROP TABLE IF EXISTS archived_memories CASCADE;

-- Drop indexes from memories table
DROP INDEX IF EXISTS idx_memories_lifecycle_state;
DROP INDEX IF EXISTS idx_memories_last_accessed;
DROP INDEX IF EXISTS idx_memories_expires_at;
DROP INDEX IF EXISTS idx_memories_pinned;

-- Remove lifecycle columns from memories table
ALTER TABLE memories DROP COLUMN IF EXISTS lifecycle_state;
ALTER TABLE memories DROP COLUMN IF EXISTS last_accessed_at;
ALTER TABLE memories DROP COLUMN IF EXISTS access_count;
ALTER TABLE memories DROP COLUMN IF EXISTS importance_score;
ALTER TABLE memories DROP COLUMN IF EXISTS decay_score;
ALTER TABLE memories DROP COLUMN IF EXISTS effective_ttl;
ALTER TABLE memories DROP COLUMN IF EXISTS pinned;
ALTER TABLE memories DROP COLUMN IF EXISTS pinned_by;
ALTER TABLE memories DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE memories DROP COLUMN IF EXISTS archived_at;
ALTER TABLE memories DROP COLUMN IF EXISTS expires_at;
