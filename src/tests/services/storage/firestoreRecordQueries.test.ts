import { beforeEach, describe, expect, it, vi } from 'vitest';

// Faults are keyed by document path / query, never by invocation number.
const state = vi.hoisted(() => ({
  replies: new Map<string, unknown>(),
  logger: vi.fn(),
  observe: vi.fn(),
}));
vi.mock('@/firebaseConfig', () => ({ db: {} }));
vi.mock('@/constants/firestorePaths', () => ({
  COLLECTIONS: { HOSPITALS: 'hospitals' },
  getActiveHospitalId: () => 'hanga_roa',
}));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  docToRecord: (data: Record<string, unknown>, date: string) => ({ date, ...data }),
  getRecordDocRef: (date: string) => `records/${date}`,
  getRecordsCollection: () => 'records',
}));
vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreQueryLogger: { error: state.logger, warn: vi.fn() },
}));
vi.mock('@/services/storage/firestore/dailyRecordSizeTelemetry', () => ({
  observeDailyRecordServerSnapshot: state.observe,
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const reply = (ref: unknown) => {
    const key = typeof ref === 'string' ? ref : JSON.stringify(ref);
    if (!state.replies.has(key)) throw new Error(`Unconfigured synthetic query: ${key}`);
    const value = state.replies.get(key);
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    ...actual,
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    getDoc: vi.fn(async ref => reply(ref)),
    getDocFromServer: vi.fn(async ref => reply(ref)),
    getDocs: vi.fn(async ref => reply(ref)),
    getDocsFromServer: vi.fn(async ref => reply(ref)),
    query: (...args: unknown[]) => args,
    where: (field: string, op: string, value: string) => ({ field, op, value }),
    orderBy: (field: string, direction: string) => ({ field, direction }),
    limit: (count: number) => ({ limit: count }),
    startAfter: (cursor: unknown) => ({ cursor }),
    onSnapshot: vi.fn((ref, _options, next, error) => {
      try {
        next(reply(ref));
      } catch (failure) {
        error(failure);
      }
      return vi.fn();
    }),
  };
});

import { getDocsFromServer } from 'firebase/firestore';
import {
  CensusMonthUnavailableError,
  getRecordFromFirestore,
  getRecordFromFirestoreDetailed,
  getRecordPagesFromFirestore,
  getRecordsRangeFromFirestore,
  getAvailableDatesFromFirestore,
  getMonthRecordsFromFirestore,
  isFirestoreAvailable,
  subscribeToRecord,
} from '@/services/storage/firestore/firestoreRecordQueries';

const date = '2026-03-14';
const snapshot = (metadata: unknown, exists = true) => ({
  exists: () => exists,
  data: () => ({ beds: {} }),
  metadata,
});
const rangeKey = (from = '2026-03-01', to = '2026-03-31') =>
  JSON.stringify([
    'records',
    { field: 'date', op: '>=', value: from },
    { field: 'date', op: '<=', value: to },
    { field: 'date', direction: 'asc' },
  ]);
const pageKey = (cursor?: unknown) =>
  JSON.stringify([
    'records',
    { field: 'date', direction: 'desc' },
    { limit: 20 },
    ...(cursor ? [{ cursor }] : []),
  ]);

describe('record query deterministic transport faults', () => {
  beforeEach(() => {
    state.replies.clear();
    vi.clearAllMocks();
    state.observe.mockReset();
  });

  it.each([
    undefined,
    { fromCache: true, hasPendingWrites: false },
    { fromCache: true, hasPendingWrites: true },
    { fromCache: false, hasPendingWrites: true },
    { fromCache: false },
    { fromCache: false, hasPendingWrites: false },
  ])(
    'derives evidence from returned metadata for present and missing documents: %s',
    async metadata => {
      const confirmed = metadata?.fromCache === false && metadata?.hasPendingWrites === false;
      for (const exists of [true, false]) {
        state.replies.set(`records/${date}`, snapshot(metadata, exists));
        expect(await getRecordFromFirestoreDetailed(date)).toMatchObject({
          status: exists ? 'resolved' : 'missing',
          serverConfirmed: confirmed,
        });
        expect(await getRecordFromFirestoreDetailed(date, { source: 'server' })).toMatchObject({
          status: confirmed ? (exists ? 'resolved' : 'missing') : 'failed',
          serverConfirmed: confirmed,
        });
      }
    }
  );

  it('distinguishes read failure from missing and keeps the nullable legacy API', async () => {
    state.replies.set(`records/${date}`, new Error('synthetic denied'));
    expect(await getRecordFromFirestoreDetailed(date)).toMatchObject({
      status: 'failed',
      record: null,
      serverConfirmed: false,
    });
    expect(await getRecordFromFirestore(date)).toBeNull();
    expect(state.logger).toHaveBeenCalledWith(
      'Firestore query failed: getRecord',
      expect.objectContaining({ date, error: expect.any(Error) })
    );
  });

  it.each([
    undefined,
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
  ])('rejects a range lacking server confirmation: %s', async metadata => {
    state.replies.set(rangeKey(), { docs: [], metadata });
    await expect(
      getRecordsRangeFromFirestore('2026-03-01', '2026-03-31', { requireServer: true })
    ).rejects.toThrow('No se pudo confirmar el período');
  });

  it('propagates range failures and wraps month failures with period and cause', async () => {
    const offline = new Error('synthetic offline');
    state.replies.set(rangeKey(), offline);
    await expect(
      getRecordsRangeFromFirestore('2026-03-01', '2026-03-31', { requireServer: true })
    ).rejects.toBe(offline);
    state.replies.set(rangeKey('2026-02-01', '2026-02-31'), offline);
    await expect(getMonthRecordsFromFirestore(2026, 1)).rejects.toBeInstanceOf(
      CensusMonthUnavailableError
    );
    await expect(getMonthRecordsFromFirestore(2026, 1)).rejects.toMatchObject({
      cause: offline,
      message: expect.stringContaining('02-2026'),
    });
  });

  it('rejects a failed date scan instead of listing no census days', async () => {
    state.replies.set(JSON.stringify(['records']), new Error('synthetic offline'));
    await expect(getAvailableDatesFromFirestore()).rejects.toThrow('synthetic offline');
    expect(state.logger).toHaveBeenCalledWith(
      'Firestore query failed: getAvailableDates',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('discards an in-flight response after cancellation without another request', async () => {
    const controller = new AbortController();
    let finish: (value: unknown) => void = () => {
      throw new Error('not started');
    };
    state.replies.set(
      pageKey(),
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const next = getRecordPagesFromFirestore(controller.signal).next();
    controller.abort();
    finish({ docs: [], size: 0 });
    await expect(next).rejects.toMatchObject({ name: 'AbortError' });
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(state.logger).not.toHaveBeenCalled();
  });

  it('propagates a later-page failure instead of accepting a partial traversal', async () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `synthetic-${i}`,
      data: () => ({ beds: {} }),
    }));
    state.replies.set(pageKey(), { docs, size: 20 });
    state.replies.set(pageKey(docs[19]), new Error('synthetic later page unavailable'));
    const pages = getRecordPagesFromFirestore();
    await pages.next();
    await expect(pages.next()).rejects.toThrow('synthetic later page unavailable');
  });

  it('retains the last delivered record on listener error and forwards the error', () => {
    const callback = vi.fn();
    const onError = vi.fn();
    state.replies.set(`records/${date}`, snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(typeof subscribeToRecord(date, callback)).toBe('function');
    state.replies.set(`records/${date}`, new Error('synthetic listener failure'));
    subscribeToRecord(date, callback, onError);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ date, beds: {} }, false, {
      fromCache: false,
      hasPendingWrites: false,
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(state.logger).toHaveBeenCalledWith(
      'Firestore query failed: subscribeToRecord',
      expect.objectContaining({ date })
    );
  });

  it('measures only confirmed versions and measurement failure cannot break delivery', () => {
    const callback = vi.fn();
    for (const metadata of [
      { fromCache: true, hasPendingWrites: false },
      { fromCache: false, hasPendingWrites: true },
    ]) {
      state.replies.set(`records/${date}`, snapshot(metadata));
      subscribeToRecord(date, callback);
      expect(callback).toHaveBeenCalledWith(
        { date, beds: {} },
        metadata.hasPendingWrites,
        metadata
      );
    }
    expect(state.observe).not.toHaveBeenCalled();
    state.replies.set(`records/${date}`, snapshot({ fromCache: false, hasPendingWrites: false }));
    subscribeToRecord(date, callback);
    expect(state.observe).toHaveBeenCalledExactlyOnceWith(date, { beds: {} });
    state.observe.mockImplementation(() => {
      throw new Error('synthetic measurement failure');
    });
    expect(() => subscribeToRecord(date, callback)).not.toThrow();
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('reports availability failure for the hospital path', async () => {
    state.replies.set('hospitals/hanga_roa', new Error('synthetic offline'));
    expect(await isFirestoreAvailable()).toBe(false);
  });
});
