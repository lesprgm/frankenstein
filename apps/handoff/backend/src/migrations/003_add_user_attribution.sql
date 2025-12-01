-- Add user_id to conversations for attribution tracking
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- Add comment explaining the field
COMMENT ON COLUMN conversations.user_id IS 'User who imported this conversation';
