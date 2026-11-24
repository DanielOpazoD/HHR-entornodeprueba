import Dexie from 'dexie';
import type { IndexedDbDatabaseLike } from '@/services/storage/indexeddb/indexedDbContracts';
import type { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';

/**
 * Narrows the runtime `hospitalDB` binding to a concrete Dexie database in tests
 * that attach Dexie hooks, call `.table()`, spy on `.Collection`, or inspect `backendDB()`.
 */
export const asDexieDatabase = (database: IndexedDbDatabaseLike): HangaRoaDatabase => {
  if (!(database instanceof Dexie)) {
    throw new Error('Expected a real Dexie database instance in test.');
  }
  return database as HangaRoaDatabase;
};
