/**
 * Database Abstraction Types
 * Defines the contract for any database provider used in the system.
 */

export interface QueryConstraint {
    field: string;
    operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'array-contains' | 'in' | 'array-contains-any';
    value: unknown;
}

export interface OrderByConstraint {
    field: string;
    direction: 'asc' | 'desc';
}

export interface QueryOptions {
    where?: QueryConstraint[];
    orderBy?: OrderByConstraint[];
    limit?: number;
    startAfter?: unknown;
}

export interface IDatabaseProvider {
    /** Get a single document by ID */
    getDoc<T>(collectionName: string, id: string): Promise<T | null>;

    /** Get multiple documents matching constraints */
    getDocs<T>(collectionName: string, options?: QueryOptions): Promise<T[]>;

    /** Set (create or overwrite) a document */
    setDoc<T>(collectionName: string, id: string, data: T, options?: { merge?: boolean }): Promise<void>;

    /** Update specific fields in a document */
    updateDoc(collectionName: string, id: string, data: Record<string, unknown>): Promise<void>;

    /** Delete a document */
    deleteDoc(collectionName: string, id: string): Promise<void>;

    /** Subscribe to real-time updates for a single document */
    subscribeDoc<T>(collectionName: string, id: string, callback: (data: T | null) => void): () => void;

    /** Subscribe to real-time updates for a query */
    subscribeQuery<T>(collectionName: string, options: QueryOptions, callback: (data: T[]) => void): () => void;

    /** Execute multiple writes as an atomic unit */
    runBatch(operations: (batch: IDatabaseBatch) => void): Promise<void>;
}

export interface IDatabaseBatch {
    set<T>(collectionName: string, id: string, data: T, options?: { merge?: boolean }): void;
    update(collectionName: string, id: string, data: Record<string, unknown>): void;
    delete(collectionName: string, id: string): void;
}
