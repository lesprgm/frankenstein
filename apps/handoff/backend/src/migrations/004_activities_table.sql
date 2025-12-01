-- Create activities table for team activity feed
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_activities_workspace_id ON activities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_activities_workspace_created ON activities(workspace_id, created_at DESC);

-- Add comments
COMMENT ON TABLE activities IS 'Activity feed for team workspaces';
COMMENT ON COLUMN activities.type IS 'Activity type: import, extraction, chat, member_added';
COMMENT ON COLUMN activities.details IS 'Additional activity-specific data (e.g., conversation count, memory count)';
