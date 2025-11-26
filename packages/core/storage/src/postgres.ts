/**
 * PostgresAdapter - Abstraction over Supabase Postgres client
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StorageError, Result } from './errors.js';
import { StorageAdapter, Transaction } from './adapter.js';

/**
 * Configuration for Postgres connection
 */
export interface PostgresConfig {
  url: string;
  apiKey: string;
  maxConnections?: number;
}

/**
 * PostgresAdapter provides type-safe database operations using Supabase
 */
export class PostgresAdapter implements StorageAdapter {
  private client: SupabaseClient;

  constructor(config: PostgresConfig) {
    this.client = createClient(config.url, config.apiKey, {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
      },
    });
  }

  /**
   * Execute a raw SQL query with parameter binding
   */
  async query<T>(sql: string, params: any[] = []): Promise<Result<T[], StorageError>> {
    try {
      const { data, error } = await this.client.rpc('exec_sql', {
        query: sql,
        params: params,
      });

      if (error) {
        return {
          ok: false,
          error: {
            type: 'database',
            message: 'Query execution failed',
            cause: error,
          },
        };
      }

      return { ok: true, value: data as T[] };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Query execution failed',
          cause: error,
        },
      };
    }
  }

  /**
   * Insert a record into a table with RETURNING clause
   */
  async insert<T>(table: string, data: object): Promise<Result<T, StorageError>> {
    try {
      const { data: result, error } = await this.client
        .from(table)
        .insert(data)
        .select()
        .single();

      if (error) {
        // Check for unique constraint violations
        if (error.code === '23505') {
          return {
            ok: false,
            error: {
              type: 'conflict',
              message: `Record already exists in ${table}`,
            },
          };
        }

        return {
          ok: false,
          error: {
            type: 'database',
            message: `Failed to insert into ${table}`,
            cause: error,
          },
        };
      }

      return { ok: true, value: result as T };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: `Failed to insert into ${table}`,
          cause: error,
        },
      };
    }
  }

  /**
   * Update a record in a table with RETURNING clause
   */
  async update<T>(table: string, id: string, data: object): Promise<Result<T, StorageError>> {
    try {
      const { data: result, error } = await this.client
        .from(table)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        // Check if record was not found
        if (error.code === 'PGRST116') {
          return {
            ok: false,
            error: {
              type: 'not_found',
              resource: table,
              id: id,
            },
          };
        }

        return {
          ok: false,
          error: {
            type: 'database',
            message: `Failed to update ${table}`,
            cause: error,
          },
        };
      }

      return { ok: true, value: result as T };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: `Failed to update ${table}`,
          cause: error,
        },
      };
    }
  }

  /**
   * Delete a record from a table
   */
  async delete(table: string, id: string): Promise<Result<void, StorageError>> {
    try {
      const { error } = await this.client
        .from(table)
        .delete()
        .eq('id', id);

      if (error) {
        return {
          ok: false,
          error: {
            type: 'database',
            message: `Failed to delete from ${table}`,
            cause: error,
          },
        };
      }

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: `Failed to delete from ${table}`,
          cause: error,
        },
      };
    }
  }

  /**
   * Helper method to extract error message from StorageError
   */
  private getErrorMessage(error: StorageError): string {
    switch (error.type) {
      case 'not_found':
        return `${error.resource} with id ${error.id} not found`;
      case 'validation':
        return `Validation error on ${error.field}: ${error.message}`;
      case 'conflict':
      case 'database':
      case 'vector_store':
        return error.message;
    }
  }

  /**
   * Begin a transaction and return a Transaction object
   */
  async beginTransaction(): Promise<Result<Transaction, StorageError>> {
    try {
      // Supabase doesn't directly expose transaction APIs in the JS client
      // We'll implement a transaction wrapper that uses the RPC approach
      const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Start transaction via RPC
      const { error: beginError } = await this.client.rpc('begin_transaction', {
        transaction_id: transactionId,
      });

      if (beginError) {
        return {
          ok: false,
          error: {
            type: 'database',
            message: 'Failed to begin transaction',
            cause: beginError,
          },
        };
      }

      const transaction: Transaction = {
        query: async <T>(sql: string, params: any[] = []): Promise<T[]> => {
          const result = await this.query<T>(sql, params);
          if (!result.ok) {
            const errorMsg = this.getErrorMessage(result.error);
            throw new Error(errorMsg);
          }
          return result.value;
        },

        insert: async <T>(table: string, data: object): Promise<T> => {
          const result = await this.insert<T>(table, data);
          if (!result.ok) {
            const errorMsg = this.getErrorMessage(result.error);
            throw new Error(errorMsg);
          }
          return result.value;
        },

        update: async <T>(table: string, id: string, data: object): Promise<T> => {
          const result = await this.update<T>(table, id, data);
          if (!result.ok) {
            const errorMsg = this.getErrorMessage(result.error);
            throw new Error(errorMsg);
          }
          return result.value;
        },

        delete: async (table: string, id: string): Promise<void> => {
          const result = await this.delete(table, id);
          if (!result.ok) {
            const errorMsg = this.getErrorMessage(result.error);
            throw new Error(errorMsg);
          }
        },

        commit: async (): Promise<void> => {
          const { error } = await this.client.rpc('commit_transaction', {
            transaction_id: transactionId,
          });
          if (error) {
            throw new Error('Failed to commit transaction');
          }
        },

        rollback: async (): Promise<void> => {
          const { error } = await this.client.rpc('rollback_transaction', {
            transaction_id: transactionId,
          });
          if (error) {
            throw new Error('Failed to rollback transaction');
          }
        },
      };

      return { ok: true, value: transaction };
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'database',
          message: 'Failed to begin transaction',
          cause: error,
        },
      };
    }
  }
}
