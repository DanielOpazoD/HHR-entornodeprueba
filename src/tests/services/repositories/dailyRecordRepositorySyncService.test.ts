import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
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

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  subscribeToRecord: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: vi.fn(),
}));

import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import {
  subscribe,
  subscribeDetailed,
  syncWithFirestoreDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';

describe('dailyRecordRepositorySyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns clean outcome when remote record is resolved', async () => {
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: { date: '2026-03-03', beds: {} } as DailyRecord,
    } as Awaited<ReturnType<typeof loadRemoteRecordWithFallback>>);

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'clean',
    });
  });

  it('returns blocked outcome when sync throws', async () => {
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);
    vi.mocked(loadRemoteRecordWithFallback).mockRejectedValueOnce(new Error('remote down'));

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'blocked',
      record: null,
      consistencyState: 'blocked',
    });
  });

  it('keeps the local record when it is newer than the remote copy', async () => {
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce({
      date: '2026-03-03',
      beds: {},
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as DailyRecord);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: {
        date: '2026-03-03',
        beds: {},
        lastUpdated: '2026-03-03T08:00:00.000Z',
      } as DailyRecord,
    } as Awaited<ReturnType<typeof loadRemoteRecordWithFallback>>);

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'clean',
      consistencyState: 'local_kept',
      sourceOfTruth: 'local',
    });
    expect(saveToIndexedDB).not.toHaveBeenCalled();
  });

  it('applies the remote record and hydrates IndexedDB when the remote copy is newer', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T08:00:00.000Z',
    } as unknown as DailyRecord;
    const remoteRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Remoto' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: remoteRecord,
    } as Awaited<ReturnType<typeof loadRemoteRecordWithFallback>>);

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'clean',
      record: expect.objectContaining({
        lastUpdated: '2026-03-03T12:00:00.000Z',
      }),
      consistencyState: 'remote_applied',
      sourceOfTruth: 'remote',
      recoveryAction: 'none',
    });
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-03',
        lastUpdated: '2026-03-03T12:00:00.000Z',
      })
    );
  });

  it('uses the newer remote canonical diagnosis when realtime emits shorter diagnosis text', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'Paciente Local',
          pathology: 'Puérpera de cesárea.',
          admissionDate: '2026-03-03',
        },
      },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;
    const remoteRecord = {
      ...localRecord,
      beds: {
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Puérpera',
        },
      },
      lastUpdated: '2026-03-03T12:00:02.000Z',
    } as unknown as DailyRecord;
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(remoteRecord, false);
      return vi.fn();
    });

    const callback = vi.fn();
    subscribeDetailed('2026-03-03', callback);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          beds: expect.objectContaining({
            R1: expect.objectContaining({
              pathology: 'Puérpera',
            }),
          }),
        }),
      }),
      false
    );
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            pathology: 'Puérpera',
          }),
        }),
      })
    );
  });

  it('returns missing_remote when the local record exists but no remote record was found', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: null,
    } as Awaited<ReturnType<typeof loadRemoteRecordWithFallback>>);

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'missing',
      record: localRecord,
      consistencyState: 'missing_remote',
      sourceOfTruth: 'local',
      recoveryAction: 'defer_remote_sync',
      retryability: 'manual_retry',
    });
    expect(saveToIndexedDB).not.toHaveBeenCalled();
  });

  it('keeps the local record as blocked fallback when the remote sync throws', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);
    vi.mocked(loadRemoteRecordWithFallback).mockRejectedValueOnce(new Error('remote down'));

    const result = await syncWithFirestoreDetailed('2026-03-03');

    expect(result).toMatchObject({
      date: '2026-03-03',
      outcome: 'blocked',
      record: localRecord,
      consistencyState: 'blocked',
      sourceOfTruth: 'local',
      recoveryAction: 'defer_remote_sync',
      retryability: 'automatic_retry',
    });
  });

  it('keeps the local record during subscription when Firestore emits a missing document', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(null, false);
      return vi.fn();
    });

    const callback = vi.fn();
    subscribe('2026-03-03', callback);

    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(localRecord, false);
  });

  it('emits detailed subscription consistency when Firestore emits a missing document', async () => {
    const localRecord = {
      date: '2026-03-03',
      beds: { R1: { patientName: 'Paciente Local' } },
      lastUpdated: '2026-03-03T12:00:00.000Z',
    } as unknown as DailyRecord;
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localRecord);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(null, false);
      return vi.fn();
    });

    const callback = vi.fn();
    subscribeDetailed('2026-03-03', callback);

    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: localRecord,
        consistencyState: 'missing_remote',
        sourceOfTruth: 'local',
      }),
      false
    );
  });

  it('does not confirm an empty day from a cache-only missing realtime snapshot', async () => {
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);

    vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
      void callback(null, false, { hasPendingWrites: false, fromCache: true });
      return vi.fn();
    });

    const callback = vi.fn();
    subscribeDetailed('2026-03-03', callback);

    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        record: null,
        outcome: 'blocked',
        consistencyState: 'blocked',
        sourceOfTruth: 'none',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
      }),
      false
    );
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
              resolve({
                date: '2026-03-03',
                beds: { R1: { patientName: 'Paciente Local' } },
                lastUpdated: '2026-03-03T12:00:00.000Z',
              } as unknown as DailyRecord);
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
