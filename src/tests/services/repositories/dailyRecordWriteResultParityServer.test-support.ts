import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * The scripted server of the write-result parity table (W14-D1-1). It has no runtime imports, so
 * the module mocks below can load it without importing the repository they replace.
 */
export type ServerAnswer =
  | { kind: 'accepts' }
  | { kind: 'accepts_with_receipt' }
  | { kind: 'refuses'; error: () => unknown }
  | { kind: 'refuses_after_session_ends'; error: () => unknown };

/** The version stamp the scripted server gives what it confirms. */
export const SERVER_CONFIRMED_AT = '2026-11-17T12:00:00.000Z';

export const endSessionHook = { current: (): void => undefined };

/** What the scripted server does; reset before each case. */
export const server = {
  enabled: true,
  answer: { kind: 'accepts' } as ServerAnswer,
  /** What a server read of the day returns (auto-merge, readbacks, specialty checks). */
  remoteDay: null as DailyRecord | null,
  writes: 0,
};

/** Replaces only the network writes of `firestoreRecordWrites`. */
export const scriptedServerWrite = async (record: Pick<DailyRecord, 'date'>): Promise<unknown> => {
  server.writes += 1;
  const answer = server.answer;
  if (answer.kind === 'accepts') return undefined;
  if (answer.kind === 'accepts_with_receipt') {
    const confirmed = {
      ...(server.remoteDay as DailyRecord),
      ...record,
      lastUpdated: SERVER_CONFIRMED_AT,
    } as DailyRecord;
    return {
      recordState: { lastUpdated: confirmed.lastUpdated, meta: { revision: 2 }, record: confirmed },
    };
  }
  if (answer.kind === 'refuses_after_session_ends') endSessionHook.current();
  throw answer.error();
};

type ImportOriginal = <T>() => Promise<T>;

/** `vi.mock('@/services/repositories/repositoryConfig', …)`. */
export const scriptedRepositoryConfig = () => ({
  isFirestoreEnabled: () => server.enabled,
  getFirestoreSyncState: () => ({ mode: server.enabled ? 'enabled' : 'disabled' }),
});

/** `vi.mock('@/services/storage/firestore/firestoreRecordWrites', …)`: only the network hop. */
export const scriptedFirestoreRecordWrites = async (importOriginal: ImportOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateRecordPartial: (date: string, patch: Record<string, unknown>) =>
    scriptedServerWrite({
      date,
      // Day-level fields only: what a receipt of a note edit carries back.
      ...Object.fromEntries(Object.entries(patch).filter(([path]) => !path.includes('.'))),
    } as Pick<DailyRecord, 'date'>),
  saveRecordToFirestore: (record: DailyRecord) => scriptedServerWrite(record),
});

/** `vi.mock('@/services/storage/firestore/firestoreRecordQueries', …)`. */
export const scriptedFirestoreRecordQueries = async (importOriginal: ImportOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRecordFromFirestore: async () => server.remoteDay,
});
