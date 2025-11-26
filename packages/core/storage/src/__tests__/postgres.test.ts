/**
 * Unit tests for PostgresAdapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresAdapter } from '../postgres';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock the Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('PostgresAdapter', () => {
  let adapter: PostgresAdapter;
  let mockClient: any;

  beforeEach(async () => {
    // Create mock Supabase client
    mockClient = {
      rpc: vi.fn(),
      from: vi.fn(),
    };

    // Mock createClient to return our mock
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValue(mockClient as any);

    adapter = new PostgresAdapter({
      url: 'https://test.supabase.co',
      apiKey: 'test-key',
    });
  });

  describe('query', () => {
    it('should execute query successfully', async () => {
      const mockData = [{ id: '1', name: 'test' }];
      mockClient.rpc.mockResolvedValue({ data: mockData, error: null });

      const result = await adapter.query('SELECT * FROM users', []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockData);
      }
    });

    it('should handle query errors', async () => {
      mockClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await adapter.query('SELECT * FROM users', []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('database');
        expect(result.error.message).toBe('Query execution failed');
      }
    });
  });

  describe('insert', () => {
    it('should insert record successfully', async () => {
      const mockRecord = { id: '1', name: 'test' };
      const mockFrom = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.insert('users', { name: 'test' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockRecord);
      }
    });

    it('should handle unique constraint violations', async () => {
      const mockFrom = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '23505', message: 'Duplicate key' },
        }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.insert('users', { email: 'test@test.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('conflict');
      }
    });
  });

  describe('update', () => {
    it('should update record successfully', async () => {
      const mockRecord = { id: '1', name: 'updated' };
      const mockFrom = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.update('users', '1', { name: 'updated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockRecord);
      }
    });

    it('should handle not found errors', async () => {
      const mockFrom = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.update('users', '999', { name: 'test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('not_found');
        expect(result.error.resource).toBe('users');
        expect(result.error.id).toBe('999');
      }
    });
  });

  describe('delete', () => {
    it('should delete record successfully', async () => {
      const mockFrom = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.delete('users', '1');

      expect(result.ok).toBe(true);
    });

    it('should handle delete errors', async () => {
      const mockFrom = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          error: { message: 'Delete failed' },
        }),
      };
      mockClient.from.mockReturnValue(mockFrom);

      const result = await adapter.delete('users', '1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('database');
      }
    });
  });
});
