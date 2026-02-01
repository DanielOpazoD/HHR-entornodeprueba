import { FirestoreProvider } from './FirestoreProvider';
import { IDatabaseProvider } from './types';

/**
 * Singleton instance of the configured database provider.
 * This allows the entire application to use a generic DB interface
 * without knowing whether it's Firestore, MongoDB, or an in-memory DB for tests.
 */
export const db: IDatabaseProvider = new FirestoreProvider();

export * from './types';
