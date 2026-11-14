import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordForDateStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { initializeDayDetailed } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
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
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

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
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });
  afterEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  it.each([
    { change: 'owner', pending: false },
    { change: 'owner', pending: true },
    { change: 'generation', pending: false },
    { change: 'generation', pending: true },
  ])(
    'rejects initialization after $change changes; pending=$pending',
    async ({ change, pending }) => {
      localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-initial');
      setSessionGeneration('synthetic-initial');
      const local = DataFactory.createMockDailyRecord(date, { nursesDayShift: ['LOCAL'] });
      if (pending) {
        await hospitalDB.dailyRecords.put(local);
        await hospitalDB.syncQueue.add({
          opId: 'synthetic-session-pending',
          type: 'UPDATE_DAILY_RECORD',
          key: `daily:${date}`,
          payload: local,
          status: 'PENDING',
          retryCount: 0,
          timestamp: 1,
        });
      }
      const beforeRows = await hospitalDB.dailyRecords.toArray();
      const beforeTasks = await hospitalDB.syncQueue.toArray();
      vi.mocked(getForDate).mockResolvedValue(null);
      const started = deferred<void>();
      const response = deferred<DailyRecord>();
      vi.mocked(loadRemoteRecordWithFallback).mockImplementation(async () => {
        started.resolve();
        return {
          record: await response.promise,
          serverConfirmed: true,
          source: 'firestore',
          compatibilityTier: 'current_firestore',
          compatibilityIntensity: 'none',
          migrationRulesApplied: [],
          cachedLocally: false,
        };
      });
      const opening = initializeDayDetailed(date);
      await started.promise;
      if (change === 'owner') localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-next');
      else setSessionGeneration('synthetic-next');
      const rejection = expect(opening).rejects.toThrow('La sesión cambió');
      response.resolve(DataFactory.createMockDailyRecord(date, { nursesDayShift: ['SERVER'] }));
      await rejection;
      expect(await hospitalDB.dailyRecords.toArray()).toEqual(beforeRows);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(beforeTasks);
      expect(save).not.toHaveBeenCalled();
    }
  );

  it.each(['owner', 'generation'])(
    'does not restart initialization when %s changes in its first read',
    async change => {
      localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-initial');
      setSessionGeneration('synthetic-initial');
      vi.mocked(getForDate).mockImplementationOnce(async () => {
        if (change === 'owner') localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-next');
        else setSessionGeneration('synthetic-next');
        return null;
      });
      await expect(initializeDayDetailed(date)).rejects.toThrow('La sesión cambió');
      expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(await hospitalDB.dailyRecords.count()).toBe(0);
    }
  );

  it('hydrates only the admitted remote row without creating a day or queue task', async () => {
    const remote = DataFactory.createMockDailyRecord(date);
    vi.mocked(getForDate).mockResolvedValue(null);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValue({
      record: remote,
      serverConfirmed: true,
      source: 'firestore',
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });
    const settings = await hospitalDB.settings.toArray();
    const result = await initializeDayDetailed(date);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual([result.record]);
    expect(result.record.beds).toEqual(remote.beds);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    expect(await hospitalDB.settings.toArray()).toEqual(settings);
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates a failed remote lookup without creating a day', async () => {
    const failure = new Error('Synthetic remote lookup failed');
    vi.mocked(getForDate).mockResolvedValue(null);
    vi.mocked(loadRemoteRecordWithFallback).mockRejectedValue(failure);

    await expect(
      initializeDayDetailed(date, undefined, { requireConfirmedAbsence: true })
    ).rejects.toBe(failure);
    expect(save).not.toHaveBeenCalled();
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('does not create a day requiring confirmed absence when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    vi.mocked(getForDate).mockResolvedValue(null);

    await expect(
      initializeDayDetailed(date, undefined, { requireConfirmedAbsence: true })
    ).rejects.toThrow('No se pudo confirmar la ausencia del día con el servidor');
    expect(save).not.toHaveBeenCalled();
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('preserves a failed initial lookup during offline copy requiring confirmed absence', async () => {
    const failure = new Error('Synthetic initial lookup failed');
    const source = DataFactory.createMockDailyRecord(copyDate, { beds: {} });
    vi.mocked(getForDate).mockImplementation(async requested => {
      if (requested === date) throw failure;
      return source;
    });
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValue({
      record: null,
      serverConfirmed: true,
      source: 'not_found',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });
    const online = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      await expect(
        initializeDayDetailed(date, copyDate, { requireConfirmedAbsence: true })
      ).rejects.toBe(failure);
      expect(save).not.toHaveBeenCalled();
      expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
    }
  });

  it('copies offline with enabled runtime even when the SDK returns cached absence', async () => {
    const source = DataFactory.createMockDailyRecord(copyDate, { beds: {} });
    vi.mocked(getForDate).mockImplementation(async requested =>
      requested === copyDate ? source : null
    );
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValue({
      record: null,
      serverConfirmed: false,
      source: 'not_found',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });
    const online = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      expect((await initializeDayDetailed(date, copyDate)).record.date).toBe(date);
      expect(save).toHaveBeenCalledOnce();
      await expect(
        initializeDayDetailed(date, copyDate, { requireConfirmedAbsence: true })
      ).rejects.toThrow();
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
    }
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
