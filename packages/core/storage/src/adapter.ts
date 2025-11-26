import { Result, StorageError } from './errors.js';

/**
 * Transaction interface for atomic operations
 */
export interface Transaction {
    query<T>(sql: string, params?: any[]): Promise<T[]>;
    insert<T>(table: string, data: object): Promise<T>;
    update<T>(table: string, id: string, data: object): Promise<T>;
    delete(table: string, id: string): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

/**
 * Common interface for storage adapters (Postgres, SQLite)
 */
export interface StorageAdapter {
    query<T>(sql: string, params?: any[]): Promise<Result<T[], StorageError>>;
    insert<T>(table: string, data: object): Promise<Result<T, StorageError>>;
    update<T>(table: string, id: string, data: object): Promise<Result<T, StorageError>>;
    delete(table: string, id: string): Promise<Result<void, StorageError>>;
    beginTransaction(): Promise<Result<Transaction, StorageError>>;
}
