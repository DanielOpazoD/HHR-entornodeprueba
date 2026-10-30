import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordForDateStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { initializeDayDetailed } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { save } from '@/services/repositories/dailyRecordRepositoryWriteService';

vi.mock('@/services/repositories/dailyRecordRepositoryReadService', () => ({
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: vi.fn(),
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  save: vi.fn(),
  updatePartial: vi.fn(),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));

const date = '2026-10-29';
const copyDate = '2026-10-28';
const deferred = <T>() => {
  let resolve = (_value: T): void => {
    throw new Error('The deferred promise was not created.');
  };
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('initialization return value after a superseded remote read', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });
  afterEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  it.each([
    { copy: false, missing: false },
    { copy: true, missing: false },
    { copy: false, missing: true },
    { copy: true, missing: true },
  ])(
    'returns the intervening local day: copy $copy, missing remote $missing',
    async ({ copy, missing }) => {
      const copySource = DataFactory.createMockDailyRecord(copyDate, { beds: {} });
      vi.mocked(getForDate).mockImplementation(async requested =>
        requested === copyDate ? copySource : null
      );
      const started = deferred<void>();
      const remote = deferred<DailyRecord | null>();
      vi.mocked(loadRemoteRecordWithFallback).mockImplementation(async requested => {
        const issuedAgainst = {
          kind: 'stored' as const,
          record: await getRecordForDateStrict(requested),
        };
        started.resolve();
        return {
          record: await remote.promise,
          issuedAgainst,
          serverConfirmed: true,
          source: missing ? 'not_found' : 'firestore',
          compatibilityTier: missing ? 'none' : 'current_firestore',
          compatibilityIntensity: 'none',
          migrationRulesApplied: [],
          cachedLocally: false,
        };
      });
      const opening = initializeDayDetailed(date, copy ? copyDate : undefined);
      await started.promise;
      const latest = DataFactory.createMockDailyRecord(date, {
        beds: {},
        nursesDayShift: ['ENFERMERA SINTETICA VIGENTE'],
      });
      await hospitalDB.dailyRecords.put(latest);
      remote.resolve(
        missing
          ? null
          : DataFactory.createMockDailyRecord(date, {
              beds: {},
              nursesDayShift: ['ENFERMERA SINTETICA ANTIGUA'],
            })
      );
      expect((await opening).record).toEqual(latest);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(latest);
      expect(save).not.toHaveBeenCalled();
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    }
  );

  it.each([false, true])(
    'fails opening instead of creating a day when local admission fails: copy %s',
    async copy => {
      const copySource = DataFactory.createMockDailyRecord(copyDate, { beds: {} });
      vi.mocked(getForDate).mockImplementation(async requested =>
        requested === copyDate ? copySource : null
      );
      const started = deferred<void>();
      const remote = deferred<DailyRecord>();
      vi.mocked(loadRemoteRecordWithFallback).mockImplementation(async requested => {
        const issuedAgainst = {
          kind: 'stored' as const,
          record: await getRecordForDateStrict(requested),
        };
        started.resolve();
        return {
          record: await remote.promise,
          issuedAgainst,
          serverConfirmed: true,
          source: 'firestore',
          compatibilityTier: 'current_firestore',
          compatibilityIntensity: 'none',
          migrationRulesApplied: [],
          cachedLocally: false,
        };
      });
      const opening = initializeDayDetailed(date, copy ? copyDate : undefined);
      await started.promise;
      const pending = {
        opId: 'synthetic-orphan',
        type: 'UPDATE_DAILY_RECORD' as const,
        key: `daily:${date}`,
        payload: DataFactory.createMockDailyRecord(date, { beds: {} }),
        status: 'PENDING' as const,
        retryCount: 0,
        timestamp: 1,
      };
      const id = await hospitalDB.syncQueue.add(pending);
      const rejected = expect(opening).rejects.toThrow(
        'No existe la copia local de una escritura pendiente.'
      );
      remote.resolve(DataFactory.createMockDailyRecord(date, { beds: {} }));
      await rejected;
      expect(save).not.toHaveBeenCalled();
      expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
      expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...pending, id });
    }
  );
});
