import { attachIndexedDbWarningBindings } from '@/services/storage/indexeddb/indexedDbWarningBindings';
import type { IndexedDbDatabaseLike } from '@/services/storage/indexeddb/indexedDbContracts';

export const attachIndexedDbEvents = (
  database: IndexedDbDatabaseLike,
  getRuntimeState: () => { isUsingMock: boolean; stickyFallbackMode: boolean },
  emittedIndexedDbWarnings: Set<string>
) => attachIndexedDbWarningBindings(database, getRuntimeState, emittedIndexedDbWarnings);
