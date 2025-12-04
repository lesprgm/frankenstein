-- Migration 004: AI Explainability
-- Stores context about why Ghost retrieved specific memories

CREATE TABLE IF NOT EXISTS explanation_contexts (
  command_id TEXT PRIMARY KEY,
  command_text TEXT NOT NULL,
  user_query TEXT NOT NULL,
  reasoning_data TEXT NOT NULL,  -- JSON: { query, retrievedCount, topMatches }
  graph_data TEXT NOT NULL,      -- JSON: { nodes: [], edges: [] }
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for recent lookups
CREATE INDEX idx_explanation_created ON explanation_contexts(created_at DESC);

-- Index for command lookup
CREATE INDEX idx_explanation_command ON explanation_contexts(command_id);
