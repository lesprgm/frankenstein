-- Migration 003: Memory Consolidation Support
-- Adds support for tracking memory versions and consolidation

-- Add columns for memory consolidation
ALTER TABLE memories ADD COLUMN parent_memory_id TEXT REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE memories ADD COLUMN consolidated_at TIMESTAMP;
ALTER TABLE memories ADD COLUMN is_active BOOLEAN DEFAULT TRUE;

-- Create index for parent lookups
CREATE INDEX idx_memories_parent ON memories(parent_memory_id) WHERE parent_memory_id IS NOT NULL;

-- Create index for active memories (speeds up searches)
CREATE INDEX idx_memories_active ON memories(is_active) WHERE is_active = TRUE;

-- Create view for active memories only (excludes consolidated ones)
CREATE VIEW active_memories AS
SELECT * FROM memories
WHERE is_active = TRUE;
