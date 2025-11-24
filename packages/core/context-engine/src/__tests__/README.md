# Context Engine Tests

This directory contains both unit tests and integration tests for the Context Engine.

## Unit Tests

Unit tests use mocked dependencies and can be run without any external services:

```bash
npm test
```

Unit tests cover:
- Embedding cache functionality
- Ranking algorithms
- Context formatting
- Error handling and validation

## Integration Tests

Integration tests require real Supabase, Vectorize, and OpenAI instances. These tests validate the complete functionality of the Context Engine against actual services.

### Prerequisites

1. **Supabase Test Database**
   - Create a test project in Supabase
   - Apply migrations from `packages/core/storage/src/migrations/001_initial_schema.sql`
   - Note the project URL and API key

2. **Vectorize Test Index**
   - Create a test index in Cloudflare Vectorize
   - Configure with 1536 dimensions (for OpenAI text-embedding-3-small)
   - Note the account ID, API token, and index name

3. **OpenAI API Key**
   - Obtain an API key from OpenAI
   - Ensure you have credits available for embedding generation

### Environment Variables

Set the following environment variables before running integration tests:

```bash
export TEST_SUPABASE_URL="https://your-project.supabase.co"
export TEST_SUPABASE_API_KEY="your-api-key"
export TEST_VECTORIZE_ACCOUNT_ID="your-account-id"
export TEST_VECTORIZE_API_TOKEN="your-api-token"
export TEST_VECTORIZE_INDEX_NAME="test-index"
export TEST_OPENAI_API_KEY="your-openai-api-key"
```

Or create a `.env.test` file in the package root:

```env
TEST_SUPABASE_URL=https://your-project.supabase.co
TEST_SUPABASE_API_KEY=your-api-key
TEST_VECTORIZE_ACCOUNT_ID=your-account-id
TEST_VECTORIZE_API_TOKEN=your-api-token
TEST_VECTORIZE_INDEX_NAME=test-index
TEST_OPENAI_API_KEY=your-openai-api-key
```

### Running Integration Tests

```bash
# Run all tests (unit + integration)
npm test

# Run only integration tests
npm test integration.test.ts

# Run with environment file
source .env.test && npm test integration.test.ts
```

### Test Coverage

The integration tests cover:

1. **End-to-end Search with Real Storage Layer and Embeddings**
   - Text query search with real OpenAI embeddings
   - Pre-computed vector search
   - Memory type filtering
   - Confidence threshold filtering

2. **buildContext with Various Options**
   - Default template formatting
   - Custom template registration and usage
   - Token budget enforcement and truncation
   - Custom ranking functions

3. **Relationship Expansion with Real Relationships**
   - Including related memories in search results
   - Following relationships to specified depth
   - Deduplication across relationship traversal

4. **Preview Matches Final Output**
   - Preview context generation
   - Diagnostic metadata (memory IDs, ranking scores, budget usage)
   - Consistency between preview and final context

5. **Error Handling with API Failures**
   - Embedding generation failures
   - Storage layer failures

6. **Graceful Degradation on Search Failures**
   - Empty context on search failures
   - No crashes on invalid inputs

### Cleanup

Integration tests automatically clean up test data after each test run. However, if tests are interrupted, you may need to manually clean up:

```sql
-- Delete test data (be careful in production!)
DELETE FROM memories WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE name LIKE '%Context Test%'
);
DELETE FROM workspaces WHERE name LIKE '%Context Test%';
DELETE FROM users WHERE email LIKE 'test-context-%@example.com';
```

### Cost Considerations

Integration tests make real API calls to OpenAI for embedding generation. Each test run may generate 20-50 embeddings depending on which tests are executed. Monitor your OpenAI usage to avoid unexpected costs.

To minimize costs during development:
- Run integration tests selectively using test name filters
- Use a separate OpenAI API key with usage limits for testing
- Consider mocking the embedding provider for most development work

### CI/CD Integration

To run integration tests in CI/CD pipelines:

1. Set up test Supabase, Vectorize, and OpenAI instances
2. Configure environment variables as secrets
3. Run migrations before tests
4. Execute tests with appropriate timeout settings

Example GitHub Actions workflow:

```yaml
- name: Run Integration Tests
  env:
    TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    TEST_SUPABASE_API_KEY: ${{ secrets.TEST_SUPABASE_API_KEY }}
    TEST_VECTORIZE_ACCOUNT_ID: ${{ secrets.TEST_VECTORIZE_ACCOUNT_ID }}
    TEST_VECTORIZE_API_TOKEN: ${{ secrets.TEST_VECTORIZE_API_TOKEN }}
    TEST_VECTORIZE_INDEX_NAME: ${{ secrets.TEST_VECTORIZE_INDEX_NAME }}
    TEST_OPENAI_API_KEY: ${{ secrets.TEST_OPENAI_API_KEY }}
  run: npm test
  timeout-minutes: 10
```

### Troubleshooting

**Tests are skipped:**
- Ensure all environment variables are set
- Check that variable names match exactly
- Verify no typos in environment variable names

**Connection errors:**
- Verify Supabase URL and API key are correct
- Check network connectivity
- Ensure Supabase project is active

**Embedding generation failures:**
- Verify OpenAI API key is valid
- Check that you have sufficient credits
- Ensure rate limits are not exceeded

**Vector search failures:**
- Verify Vectorize index exists
- Check API token permissions
- Ensure embedding dimensions match index configuration (1536 for text-embedding-3-small)

**Relationship tests fail:**
- Verify Storage Layer is properly configured
- Check that foreign key constraints are in place
- Ensure workspace scoping is working correctly

### Performance Notes

Integration tests may take several seconds to complete due to:
- Real API calls to OpenAI (100-500ms per embedding)
- Network latency to Supabase and Vectorize
- Database operations and vector search

Typical test run duration: 10-30 seconds depending on network conditions.
