// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  FirestoreProvider,
  type FirestoreProviderApi,
} from '@/services/infrastructure/db/FirestoreProvider';

const buildApi = () => {
  const batch = {
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  const collectionMock = vi.fn(() => 'collection-ref');
  const deleteDocMock = vi.fn().mockResolvedValue(undefined);
  const docMock = vi.fn((_firestore: unknown, collectionName?: string, id?: string) => {
    return `${collectionName}/${id}`;
  });
  const getDocMock = vi.fn();
  const getDocsMock = vi.fn();
  const limitMock = vi.fn(value => `limit:${value}`);
  const onSnapshotMock = vi.fn((_target: unknown, callback: (value: unknown) => void) => {
    callback({
      docs: [{ id: 'doc-1', data: () => ({ title: 'Recordatorio' }) }],
    });
    return vi.fn();
  });
  const orderByMock = vi.fn((field, direction) => `orderBy:${field}:${direction}`);
  const queryMock = vi.fn((_collectionRef, ...constraints) => constraints);
  const setDocMock = vi.fn().mockResolvedValue(undefined);
  const startAfterMock = vi.fn(value => `startAfter:${String(value)}`);
  const updateDocMock = vi.fn().mockResolvedValue(undefined);
  const whereMock = vi.fn(
    (field, operator, value) => `where:${field}:${operator}:${String(value)}`
  );
  const writeBatchMock = vi.fn(() => batch);

  const api = {
    collection: collectionMock,
    deleteDoc: deleteDocMock,
    doc: docMock,
    getDoc: getDocMock,
    getDocs: getDocsMock,
    limit: limitMock,
    onSnapshot: onSnapshotMock,
    orderBy: orderByMock,
    query: queryMock,
    setDoc: setDocMock,
    startAfter: startAfterMock,
    updateDoc: updateDocMock,
    where: whereMock,
    writeBatch: writeBatchMock,
  } as unknown as FirestoreProviderApi;

  return {
    api,
    batch,
    collectionMock,
    deleteDocMock,
    docMock,
    getDocMock,
    getDocsMock,
    limitMock,
    onSnapshotMock,
    orderByMock,
    queryMock,
    setDocMock,
    startAfterMock,
    updateDocMock,
    whereMock,
    writeBatchMock,
  };
};

describe('FirestoreProvider', () => {
  it('uses injected firestore/api dependencies to read lists', async () => {
    const {
      api,
      collectionMock,
      getDocsMock,
      limitMock,
      orderByMock,
      queryMock,
      startAfterMock,
      whereMock,
    } = buildApi();
    getDocsMock.mockResolvedValue({
      docs: [{ id: 'doc-1', data: () => ({ title: 'Recordatorio' }) }],
    });

    const provider = new FirestoreProvider({
      firestore: {} as never,
      api,
    });

    const result = await provider.getDocs<{ id: string; title: string }>('reminders', {
      where: [{ field: 'active', operator: '==', value: true }],
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
      limit: 10,
      startAfter: 'cursor',
    });

    expect(result).toEqual([{ id: 'doc-1', title: 'Recordatorio' }]);
    expect(collectionMock).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalledWith('active', '==', true);
    expect(orderByMock).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(startAfterMock).toHaveBeenCalledWith('cursor');
    expect(queryMock).toHaveBeenCalled();
  });

  it('passes merge options through batch writes', async () => {
    const { api, batch } = buildApi();
    const provider = new FirestoreProvider({
      firestore: {} as never,
      api,
    });

    await provider.runBatch(dbBatch => {
      dbBatch.set('config', 'roles', { admin: true }, { merge: true });
      dbBatch.update('config', 'roles', { editor: false });
      dbBatch.delete('config', 'legacy');
    });

    expect(batch.set).toHaveBeenCalledWith('config/roles', { admin: true }, { merge: true });
    expect(batch.update).toHaveBeenCalledWith('config/roles', { editor: false });
    expect(batch.delete).toHaveBeenCalledWith('config/legacy');
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('maps realtime query snapshots into typed records', () => {
    const { api } = buildApi();
    const provider = new FirestoreProvider({
      firestore: {} as never,
      api,
    });
    const callback = vi.fn();

    provider.subscribeQuery('reminders', { limit: 1 }, callback);

    expect(callback).toHaveBeenCalledWith([{ id: 'doc-1', title: 'Recordatorio' }]);
  });

  it('resolves firestore lazily through the injected getter', async () => {
    const { api, collectionMock, docMock, getDocsMock, getDocMock } = buildApi();
    getDocsMock.mockResolvedValue({ docs: [] });
    getDocMock.mockResolvedValue({
      exists: () => false,
    });
    const firestoreRef = { current: undefined as unknown };
    const provider = new FirestoreProvider({
      getFirestore: () => firestoreRef.current as never,
      api,
    });

    firestoreRef.current = { instance: 'live-firestore' };

    await provider.getDocs('reminders');
    await provider.getDoc('reminders', 'doc-1');

    expect(collectionMock).toHaveBeenCalledWith(firestoreRef.current, 'reminders');
    expect(docMock).toHaveBeenCalledWith(firestoreRef.current, 'reminders', 'doc-1');
  });
});
