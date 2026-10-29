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
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';

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
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  });

  afterEach(async () => {
    for (const stop of subscriptions.splice(0)) stop();
    queryClient.clear();
    resetDailyRecordFreshnessGateForTests();
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
        subscribeDetailed: (subscriptionDate, callback) =>
          subscribeDetailed(subscriptionDate, (result, pending) => {
            results.push(result);
            callback(result, pending);
          }),
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
    return { listener, visible, results, getForDateWithMeta };
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
});
