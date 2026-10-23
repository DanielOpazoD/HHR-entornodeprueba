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

export const createSingleAttemptFirestoreMock = () => {
  const getDoc = vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined });
  const setDoc = vi.fn().mockResolvedValue(undefined);
  return { getDoc, setDoc, runTransaction: singleAttemptFirestoreTransactionMock(getDoc, setDoc) };
};
