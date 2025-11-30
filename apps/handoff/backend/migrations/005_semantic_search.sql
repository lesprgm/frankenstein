-- Phase 4: Semantic Search with pgvector
-- Enable vector extension and add embedding column to memories

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to memories table
ALTER TABLE memories 
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for vector similarity search (using cosine distance)
CREATE INDEX IF NOT EXISTS memories_embedding_idx 
ON memories 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Add comment explaining the column
COMMENT ON COLUMN memories.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions) for semantic search';
