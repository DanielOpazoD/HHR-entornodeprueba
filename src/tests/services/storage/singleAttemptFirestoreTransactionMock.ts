import { vi } from 'vitest';
import type { Firestore, Transaction, getDoc, setDoc } from 'firebase/firestore';

/** Single-attempt test double. SDK retries are covered separately. */
export const singleAttemptFirestoreTransactionMock = (read: typeof getDoc, write: typeof setDoc) =>
  vi.fn(async <T>(_db: Firestore, update: (transaction: Transaction) => Promise<T>) => {
    const pending: Array<() => Promise<void>> = [];
    const transaction = {
      get: read,
      set: (...args: Parameters<typeof setDoc>) => {
        pending.push(() => write(...args));
        return transaction;
      },
    };
    const result = await update(transaction as unknown as Transaction);
    for (const commit of pending) await commit();
    return result;
  });

let mockedSetDoc: ((...args: unknown[]) => Promise<unknown>) | undefined;

export const createSingleAttemptFirestoreMock = () => {
  const getDoc = vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined });
  const setDoc = vi.fn().mockResolvedValue(undefined);
  mockedSetDoc = setDoc;
  return { getDoc, setDoc, runTransaction: singleAttemptFirestoreTransactionMock(getDoc, setDoc) };
};

type AuthorityClient =
  typeof import('@/services/storage/firestore/dailyRecordAuthorityCallableClient');

/**
 * Stands in for the authority save callable, which every queue publish of a day uses: it writes
 * the record it is sent through the `setDoc` of createSingleAttemptFirestoreMock, so a test's
 * failing `setDoc` fails the publish, and answers with that record as committed.
 */
export const createAuthorityCallableMock = async (): Promise<AuthorityClient> => {
  const actual = await vi.importActual<AuthorityClient>(
    '@/services/storage/firestore/dailyRecordAuthorityCallableClient'
  );
  return {
    ...actual,
    saveDailyRecordWithClinicalAuthorityCallable: vi.fn<
      AuthorityClient['saveDailyRecordWithClinicalAuthorityCallable']
    >(async (payload, assertCanPublish) => {
      assertCanPublish?.();
      const { getRecordDocRef } = await import('@/services/storage/firestore/firestoreShared');
      await mockedSetDoc?.(getRecordDocRef(payload.date), payload.record);
      return {
        success: true,
        date: payload.date,
        mode: 'enforced' as const,
        authorityStatus: 'ok' as const,
        violations: [],
        recordState: {
          record: payload.record,
          lastUpdated: payload.record.lastUpdated,
          meta: {},
        },
      };
    }),
  };
};
