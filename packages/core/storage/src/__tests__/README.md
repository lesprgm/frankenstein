# Integration Tests

This directory contains both unit tests and integration tests for the storage layer.

## Unit Tests

Unit tests use mocked dependencies and can be run without any external services:

```bash
npm test
```

## Integration Tests

Integration tests require real Supabase and Vectorize instances. These tests validate the complete functionality of the storage layer against actual databases.

### Prerequisites

1. **Supabase Test Database**
   - Create a test project in Supabase
   - Apply migrations from `src/migrations/001_initial_schema.sql`
   - Note the project URL and API key

2. **Vectorize Test Index**
   - Create a test index in Cloudflare Vectorize
   - Configure with 384 dimensions (or match your embedding model)
   - Note the account ID, API token, and index name

### Environment Variables

Set the following environment variables before running integration tests:

```bash
export TEST_SUPABASE_URL="https://your-project.supabase.co"
export TEST_SUPABASE_API_KEY="your-api-key"
export TEST_VECTORIZE_ACCOUNT_ID="your-account-id"
export TEST_VECTORIZE_API_TOKEN="your-api-token"
export TEST_VECTORIZE_INDEX_NAME="test-index"
```

Or create a `.env.test` file:

```env
TEST_SUPABASE_URL=https://your-project.supabase.co
TEST_SUPABASE_API_KEY=your-api-key
TEST_VECTORIZE_ACCOUNT_ID=your-account-id
TEST_VECTORIZE_API_TOKEN=your-api-token
TEST_VECTORIZE_INDEX_NAME=test-index
```

### Running Integration Tests

```bash
# Run all tests (unit + integration)
npm test

# Run only integration tests
npm test -- integration.test.ts

# Run with environment file
source .env.test && npm test -- integration.test.ts
```

### Test Coverage

The integration tests cover:

1. **User and Workspace CRUD Operations**
   - Creating and retrieving users
   - Handling duplicate emails
   - Creating and listing workspaces
   - Workspace type validation

2. **Conversation Operations with Workspace Scoping**
   - Creating conversations within workspaces
   - Enforcing workspace boundaries on retrieval
   - Pagination and ordering

3. **Memory Operations with Embedding Lifecycle**
   - Creating memories with and without embeddings
   - Storing embeddings in Vectorize
   - Workspace scoping enforcement
   - Type filtering
   - Deleting memories from both Postgres and Vectorize

4. **Semantic Search with Actual Embeddings**
   - Vector similarity search
   - Type filtering in search results
   - Workspace scoping in search

5. **Relationship Operations with Workspace Validation**
   - Creating relationships between memories
   - Retrieving relationships for a memory
   - Preventing cross-workspace relationships

6. **Transaction Rollback Scenarios**
   - Successful transaction commits
   - Automatic rollback on errors
   - Data consistency verification

### Cleanup

Integration tests automatically clean up test data after each test run. However, if tests are interrupted, you may need to manually clean up:

```sql
-- Delete test data (be careful in production!)
DELETE FROM users WHERE email LIKE 'test-%@example.com';
DELETE FROM users WHERE email LIKE 'user-%@example.com';
DELETE FROM users WHERE email LIKE 'duplicate-%@example.com';
```

### CI/CD Integration

To run integration tests in CI/CD pipelines:

1. Set up test Supabase and Vectorize instances
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
  run: npm test
  timeout-minutes: 10
```

### Troubleshooting

**Tests are skipped:**
- Ensure all environment variables are set
- Check that variable names match exactly

**Connection errors:**
- Verify Supabase URL and API key are correct
- Check network connectivity
- Ensure Supabase project is active

**Vector search failures:**
- Verify Vectorize index exists
- Check API token permissions
- Ensure embedding dimensions match index configuration

**Transaction tests fail:**
- Verify Supabase has transaction support enabled
- Check that RPC functions are properly configured
