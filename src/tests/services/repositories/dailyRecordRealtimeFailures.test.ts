import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { SnapshotMetadata } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  DailyRecordReadResult,
  DailyRecordQueryResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';

type SyntheticSnapshot = {
  metadata: SnapshotMetadata;
  exists: () => boolean;
  data: () => DailyRecord;
};

const sdk = vi.hoisted(() => {
  const listeners: Array<{
    next: (snapshot: SyntheticSnapshot) => void;
    error: (error: unknown) => void;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  return { listeners };
});

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({ id: 'synthetic-records' })),
  doc: vi.fn((_collection: unknown, id: string) => ({ id })),
  getDoc: vi.fn(() => Promise.reject(new Error('Unexpected SDK network read'))),
  getDocFromServer: vi.fn(() => Promise.reject(new Error('Unexpected SDK server read'))),
  onSnapshot: vi.fn(
    (
      _reference: unknown,
      _options: unknown,
      next: (snapshot: SyntheticSnapshot) => void,
      error: (error: unknown) => void
    ) => {
      const stop = vi.fn();
      sdk.listeners.push({ next, error, stop });
      return stop;
    }
  ),
}));

import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import {
  createDailyRecordSubscription,
  createDailyRecordQueryOptions,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  reportBasicReadPermissionDenied,
  resetSessionPermissionStormDetector,
  subscribeToSessionPermissionStorm,
} from '@/services/auth/sessionPermissionStormDetector';
import {
  clearPendingDailyRecordPatchesForTests,
  PENDING_DAILY_RECORD_PATCH_STORAGE_KEY,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

const date = '2026-10-29';
const confirmedRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-10-29T12:00:00.000Z',
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO REALTIME',
        admissionDate: date,
        admissionTime: '08:00',
        pathology: 'DIAGNOSTICO SINTETICO CONSERVADO',
      }),
    },
  });

const serverSnapshot = (record: DailyRecord): SyntheticSnapshot => ({
  exists: () => true,
  data: () => record,
  metadata: { fromCache: false, hasPendingWrites: false, isEqual: () => false },
});

describe('daily census after a terminal SDK listener failure', () => {
  let queryClient: QueryClient;
  const subscriptions: Array<() => void> = [];

  beforeEach(async () => {
    sdk.listeners.length = 0;
    localStorage.clear();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    resetDailyRecordFreshnessGateForTests();
    resetSessionPermissionStormDetector();
    clearPendingDailyRecordPatchesForTests();
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  });

  afterEach(async () => {
    for (const stop of subscriptions.splice(0)) stop();
    queryClient.clear();
    resetDailyRecordFreshnessGateForTests();
    resetSessionPermissionStormDetector();
    clearPendingDailyRecordPatchesForTests();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  const start = () => {
    const results: SyncDailyRecordResult[] = [];
    const getForDateWithMeta = vi
      .fn<() => Promise<DailyRecordReadResult>>()
      .mockRejectedValue(new Error('Unexpected fallback point read'));
    const stop = createDailyRecordSubscription(
      {
        getForDateWithMeta,
        subscribeDetailed: (subscriptionDate, callback, onFailure) =>
          subscribeDetailed(
            subscriptionDate,
            (result, pending) => {
              results.push(result);
              callback(result, pending);
            },
            result => {
              results.push(result);
              onFailure?.(result);
            }
          ),
      },
      date,
      queryClient
    );
    if (!stop) throw new Error('The real subscription controller did not start');
    subscriptions.push(stop);
    const listener = sdk.listeners.at(-1);
    if (!listener) throw new Error('The real Firestore wrapper did not subscribe to the SDK');
    const visible = () =>
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date));
    return { listener, visible, results, getForDateWithMeta, stop };
  };

  it('preserves the confirmed census and reports blocked runtime after an SDK error', async () => {
    const record = confirmedRecord();
    await hospitalDB.dailyRecords.put(record);
    const { listener, visible, results, getForDateWithMeta } = start();

    listener.next(serverSnapshot(record));
    await vi.waitFor(() => expect(visible()?.runtime.serverConfirmed).toBe(true), {
      timeout: 500,
      interval: 10,
    });
    const before = visible();
    expect(before?.record?.beds.R1.patientName).toBe('PACIENTE SINTETICO REALTIME');
    expect(results.at(-1)).toMatchObject({ outcome: 'clean', serverConfirmed: true });

    listener.error({ code: 'unavailable', message: 'Synthetic terminal listener failure' });

    await vi.waitFor(
      () => {
        expect(visible()?.record).toBe(before?.record);
        expect(visible()?.runtime).toMatchObject({
          serverConfirmed: false,
          consistencyState: 'blocked',
        });
      },
      { timeout: 500, interval: 10 }
    );
    expect(results.at(-1)).toMatchObject({ outcome: 'blocked', serverConfirmed: false });
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.patientName).toBe(
      'PACIENTE SINTETICO REALTIME'
    );
    expect(getForDateWithMeta).not.toHaveBeenCalled();
  });

  it('accepts a later valid server snapshot through the same real subscription path', async () => {
    const record = confirmedRecord();
    await hospitalDB.dailyRecords.put(record);
    const { listener, visible, getForDateWithMeta } = start();
    listener.next(serverSnapshot(record));
    await vi.waitFor(() => expect(visible()?.runtime.serverConfirmed).toBe(true), {
      timeout: 500,
      interval: 10,
    });

    const updated = {
      ...record,
      lastUpdated: '2026-10-29T12:01:00.000Z',
      beds: {
        R1: { ...record.beds.R1, pathology: 'DIAGNOSTICO SINTETICO ACTUALIZADO' },
      },
    };
    listener.next(serverSnapshot(updated));
    await vi.waitFor(
      () => expect(visible()?.record?.beds.R1.pathology).toBe('DIAGNOSTICO SINTETICO ACTUALIZADO'),
      { timeout: 500, interval: 10 }
    );
    expect(visible()?.runtime.serverConfirmed).toBe(true);
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(
      'DIAGNOSTICO SINTETICO ACTUALIZADO'
    );
    expect(getForDateWithMeta).not.toHaveBeenCalled();
  });

  it('preserves cached data without another permission source when local storage has no copy', async () => {
    const record = confirmedRecord();
    await hospitalDB.dailyRecords.put(record);
    const { listener, visible, getForDateWithMeta } = start();
    const storm = vi.fn();
    subscriptions.push(subscribeToSessionPermissionStorm(storm));
    listener.next(serverSnapshot(record));
    await vi.waitFor(() => expect(visible()?.runtime.serverConfirmed).toBe(true));
    const before = visible();
    await hospitalDB.dailyRecords.clear();

    listener.error({ code: 'permission-denied', message: 'Synthetic listener denial' });

    expect(visible()?.record).toBe(before?.record);
    expect(visible()?.runtime).toMatchObject({
      serverConfirmed: false,
      consistencyState: 'blocked',
      sourceOfTruth: before?.runtime.sourceOfTruth,
      retryability: 'manual_retry',
    });
    expect(getForDateWithMeta).not.toHaveBeenCalled();
    expect(storm).not.toHaveBeenCalled();
    reportBasicReadPermissionDenied('synthetic:independent');
    expect(storm).toHaveBeenCalledExactlyOnceWith({
      sources: ['records:subscribeToRecord', 'synthetic:independent'],
      detectedAt: expect.any(Number),
    });
  });

  it('reports unavailable rather than confirmed absence when the listener fails before any data', () => {
    const { listener, visible, getForDateWithMeta } = start();
    listener.error({ code: 'unavailable' });
    expect(visible()).toMatchObject({
      record: null,
      runtime: {
        serverConfirmed: false,
        consistencyState: 'blocked',
        availabilityState: 'temporarily_unavailable',
      },
    });
    expect(getForDateWithMeta).not.toHaveBeenCalled();
  });

  it('does not let a null-snapshot recovery in flight erase the later listener failure', async () => {
    const record = confirmedRecord();
    const { listener, visible, getForDateWithMeta } = start();
    listener.next(serverSnapshot(record));
    await vi.waitFor(() => expect(visible()?.runtime.serverConfirmed).toBe(true));
    const before = visible();
    await hospitalDB.dailyRecords.clear();
    const recovery = Promise.withResolvers<DailyRecordReadResult>();
    getForDateWithMeta.mockReturnValueOnce(recovery.promise);
    listener.next({
      ...serverSnapshot(record),
      exists: () => false,
      metadata: { fromCache: true, hasPendingWrites: false, isEqual: () => false },
    });
    await vi.waitFor(() => expect(getForDateWithMeta).toHaveBeenCalledTimes(1));

    listener.error({ code: 'unavailable' });
    const failed = visible();
    recovery.resolve(
      createDailyRecordReadResult(date, record, 'firestore', { serverConfirmed: true })
    );
    await recovery.promise;
    await Promise.resolve();

    expect(visible()).toBe(failed);
    expect(visible()?.record).toBe(before?.record);
    expect(visible()?.runtime.serverConfirmed).toBe(false);
    expect(visible()?.runtime.consistencyState).toBe('blocked');
    expect(getForDateWithMeta).toHaveBeenCalledTimes(1);
  });

  const unresolved: Array<SyncTask['status']> = ['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'];
  it.each(unresolved)(
    'keeps a %s write and explicit patch unchanged on listener failure',
    async status => {
      const record = confirmedRecord();
      const pending = { ...record, tensDayShift: ['SINTETICO PENDIENTE'] };
      await hospitalDB.dailyRecords.put(pending);
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-realtime-pending',
        type: 'UPDATE_DAILY_RECORD',
        key: `daily:${date}`,
        payload: pending,
        timestamp: Date.parse(record.lastUpdated),
        retryCount: 1,
        status,
        syncContract: { expectedVersion: record.lastUpdated, changedPaths: ['tensDayShift'] },
      });
      const { listener, visible, getForDateWithMeta } = start();
      listener.next(serverSnapshot(record));
      await vi.waitFor(() => expect(visible()?.record?.tensDayShift).toEqual(pending.tensDayShift));
      registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'PARCHE SINTETICO PENDIENTE' });
      listener.next(serverSnapshot(record));
      await vi.waitFor(() =>
        expect(visible()?.record?.beds.R1.pathology).toBe('PARCHE SINTETICO PENDIENTE')
      );
      const before = visible();
      expect(before?.record?.beds.R1.pathology).toBe('PARCHE SINTETICO PENDIENTE');
      const queue = await hospitalDB.syncQueue.toArray();
      const patches = localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);

      listener.error({ code: 'unavailable' });

      expect(visible()?.record).toBe(before?.record);
      expect(visible()?.runtime.serverConfirmed).toBe(false);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(queue);
      expect((await hospitalDB.dailyRecords.get(date))?.tensDayShift).toEqual(pending.tensDayShift);
      expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBe(patches);
      expect(getForDateWithMeta).not.toHaveBeenCalled();
    }
  );

  it('allows a later explicit server read to recover without reviving the terminal listener', async () => {
    const record = confirmedRecord();
    const { listener, visible, getForDateWithMeta } = start();
    listener.next(serverSnapshot(record));
    await vi.waitFor(() => expect(visible()?.runtime.serverConfirmed).toBe(true));
    listener.error({ code: 'unavailable' });
    const updated = {
      ...record,
      lastUpdated: '2026-10-29T12:03:00.000Z',
      tensDayShift: ['SINTETICO REMOTO'],
    };
    getForDateWithMeta.mockResolvedValueOnce(
      createDailyRecordReadResult(date, updated, 'firestore', {
        serverConfirmed: true,
      })
    );
    const result = await createDailyRecordQueryOptions(
      { getForDateWithMeta },
      date,
      queryClient
    ).queryFn();
    queryClient.setQueryData(getDailyRecordQueryKey(date), result);
    expect(visible()?.record?.tensDayShift).toEqual(['SINTETICO REMOTO']);
    expect(visible()?.runtime.serverConfirmed).toBe(true);
    listener.next(serverSnapshot(record));
    expect(visible()?.record?.tensDayShift).toEqual(['SINTETICO REMOTO']);
    expect(sdk.listeners).toHaveLength(1);
  });

  it('contains an error callback thrown at the SDK adapter boundary', () => {
    const onError = vi.fn(() => {
      throw new Error('Synthetic consumer failure');
    });
    subscriptions.push(subscribeToRecord(date, vi.fn(), onError));
    const listener = sdk.listeners.at(-1);
    if (!listener) throw new Error('SDK listener missing');
    expect(() => listener.error({ code: 'unavailable' })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
