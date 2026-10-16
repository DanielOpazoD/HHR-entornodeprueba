import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import { subscribeToFirestoreDocument } from '@/services/storage/firestore/firestoreDocumentStore';

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  onSnapshot: mocks.subscribe,
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));
type Snapshot = { exists: () => boolean; data: () => unknown };
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const setup = (ready?: Promise<void>) => {
  const onData = vi.fn();
  const onError = vi.fn();
  const resolveRef = vi.fn(() => ({}) as DocumentReference);
  const unsubscribe = subscribeToFirestoreDocument({
    runtime: { getDb: () => ({}) as Firestore, ready },
    resolveRef,
    onData,
    onError,
  });
  return { onData, onError, resolveRef, unsubscribe };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
});

describe('Firestore document subscription lifetime', () => {
  it('does not open a listener when readiness resolves after cancellation', async () => {
    const ready = deferred();
    const { unsubscribe } = setup(ready.promise);
    unsubscribe();
    ready.resolve();
    await flush();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('does not publish a readiness failure after cancellation', async () => {
    const ready = deferred();
    const { unsubscribe, onError } = setup(ready.promise);
    unsubscribe();
    ready.reject(new Error('Retired runtime unavailable'));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('ignores queued data and error callbacks from a canceled listener', async () => {
    const { unsubscribe, onData, onError } = setup();
    await flush();
    const [, next, error] = mocks.subscribe.mock.calls[0] as [
      DocumentReference,
      (snapshot: Snapshot) => void,
      (error: Error) => void,
    ];
    unsubscribe();
    next({ exists: () => true, data: () => ({ value: 'old' }) });
    error(new Error('permission-denied'));
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still reports a readiness failure to an active owner', async () => {
    const ready = deferred();
    const { onError } = setup(ready.promise);
    const failure = new Error('permission-denied');
    ready.reject(failure);
    await flush();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('keeps active snapshot data, missing documents and permission errors observable', async () => {
    const { onData, onError } = setup();
    await flush();
    const [, next, error] = mocks.subscribe.mock.calls[0] as [
      DocumentReference,
      (snapshot: Snapshot) => void,
      (error: Error) => void,
    ];
    next({ exists: () => true, data: () => ({ value: 'current' }) });
    next({ exists: () => false, data: () => undefined });
    const failure = new Error('permission-denied');
    error(failure);
    expect(onData.mock.calls).toEqual([[{ value: 'current' }], [null]]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
