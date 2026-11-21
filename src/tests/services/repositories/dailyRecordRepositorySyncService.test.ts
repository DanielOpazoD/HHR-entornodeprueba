import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: vi.fn(),
  captureLocalRecordBase: async (date: string) => ({
    kind: 'stored',
    record: await getRecordFromIndexedDB(date),
  }),
  inspectLocalRecordAdmission: async (_date: string, base: { record: DailyRecord | null }) => ({
    status: 'admitted',
    record: base.record,
  }),
  admitLocalRecords: async (candidates: Array<{ record: DailyRecord; expectedBase?: unknown }>) => {
    for (const candidate of candidates)
      await saveToIndexedDB(candidate.record, {
        preserveUnresolvedWrites: true,
        ...(candidate.expectedBase ? { expectedBase: candidate.expectedBase } : {}),
      } as Parameters<typeof saveToIndexedDB>[1]);
    return candidates.map(({ record }) => ({ date: record.date, status: 'admitted', record }));
  },
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  getRecordForDateStrict as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

describe('dailyRecordRepositorySyncService', () => {
  const subscriptions: Array<() => void> = [];

  afterEach(() => {
    for (const stop of subscriptions.splice(0)) stop();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecordFromIndexedDB).mockReset().mockResolvedValue(null);
    vi.mocked(subscribeToRecord).mockReset();
  });

  it('uses the newer remote canonical diagnosis when realtime emits shorter diagnosis text', async () => {
    const localRecord = DataFactory.createMockDailyRecord('2026-03-03', {
      beds: {
        R1: {
          ...createEmptyPatient('R1'),
          patientName: 'Paciente Local',
          pathology: 'Puérpera de cesárea.',
          admissionDate: '2026-03-03',
        },
      },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    });
    const remoteRecord = DataFactory.createMockDailyRecord('2026-01-01', {
      ...localRecord,
      beds: {
        R1: { ...createEmptyPatient('R1'), ...localRecord.beds.R1, pathology: 'Puérpera' },
      },
      lastUpdated: '2026-03-03T12:00:02.000Z',
    });
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(remoteRecord, false, { fromCache: false, hasPendingWrites: false });
      return vi.fn();
    });

    const callback = vi.fn();
    const delivered = new Promise<void>(resolve =>
      callback.mockImplementationOnce(() => resolve())
    );
    subscriptions.push(subscribeDetailed('2026-03-03', callback));
    await delivered;

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          beds: expect.objectContaining({
            R1: expect.objectContaining({
              pathology: 'Puérpera',
            }),
          }),
        }),
        serverConfirmed: true,
        consistencyState: 'remote_authoritative',
      })
    );
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            pathology: 'Puérpera',
          }),
        }),
      }),
      { preserveUnresolvedWrites: true, expectedBase: { kind: 'stored', record: localRecord } }
    );
  });

  it('emits detailed subscription consistency when Firestore emits a missing document', async () => {
    const localRecord = DataFactory.createMockDailyRecord('2026-03-03', {
      beds: { R1: { ...createEmptyPatient('R1'), patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    });
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(null, false, { fromCache: false, hasPendingWrites: false });
      return vi.fn();
    });

    const callback = vi.fn();
    const delivered = new Promise<void>(resolve =>
      callback.mockImplementationOnce(() => resolve())
    );
    subscriptions.push(subscribeDetailed('2026-03-03', callback));
    await delivered;

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: localRecord,
        serverConfirmed: true,
        consistencyState: 'local_authoritative',
        sourceOfTruth: 'local',
      })
    );
  });

  it('does not confirm an empty day from a cache-only missing realtime snapshot', async () => {
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(null, false, { hasPendingWrites: false, fromCache: true });
      return vi.fn();
    });

    const callback = vi.fn();
    const delivered = new Promise<void>(resolve =>
      callback.mockImplementationOnce(() => resolve())
    );
    subscriptions.push(subscribeDetailed('2026-03-03', callback));
    await delivered;

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: null,
        serverConfirmed: false,
        consistencyState: 'unavailable',
        sourceOfTruth: 'none',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
      })
    );
  });

  it('does not resolve a snapshot of its own pending writes and drops the one it overtook', async () => {
    const record = DataFactory.createMockDailyRecord('2026-03-03', {
      beds: { R1: { ...createEmptyPatient('R1'), patientName: 'Paciente Local' } },
    });
    let emit: Parameters<typeof subscribeToRecord>[1] | undefined;
    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      emit = callback;
      return vi.fn();
    });
    const callback = vi.fn();
    subscriptions.push(subscribeDetailed('2026-03-03', callback));

    void emit!(record, false, { fromCache: false, hasPendingWrites: false });
    void emit!(record, true, { fromCache: true, hasPendingWrites: true });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores async subscription results that complete after unsubscribe', async () => {
    let emitRecord: ((record: DailyRecord | null, hasPendingWrites: boolean) => void) | null = null;
    const unsubscribe = vi.fn();

    vi.useFakeTimers();

    try {
      vi.mocked(getRecordFromIndexedDB).mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(() => {
              resolve(
                DataFactory.createMockDailyRecord('2026-03-03', {
                  beds: { R1: { ...createEmptyPatient('R1'), patientName: 'Paciente Local' } },
                  lastUpdated: '2026-03-03T12:00:00.000Z',
                })
              );
            }, 0);
          })
      );

      vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
        emitRecord = callback;
        return unsubscribe;
      });

      const callback = vi.fn();
      const stop = subscribeDetailed('2026-03-03', callback);

      expect(emitRecord).toBeTypeOf('function');
      const fireSubscription = emitRecord as unknown as (
        record: DailyRecord | null,
        hasPendingWrites: boolean
      ) => void;
      fireSubscription(null, false);
      stop();
      await vi.runAllTimersAsync();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
