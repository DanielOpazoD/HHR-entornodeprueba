import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    saveDetailed: vi.fn().mockResolvedValue({
      date: '2025-12-27',
      outcome: 'clean',
      savedLocally: true,
      savedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
    }),
    subscribe: vi.fn(() => vi.fn()),
    subscribeDetailed: vi.fn(() => vi.fn()),
    updatePartial: vi.fn().mockResolvedValue(undefined),
    updatePartialDetailed: vi.fn().mockResolvedValue({
      date: '2025-12-27',
      outcome: 'clean',
      savedLocally: true,
      updatedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
      patchedFields: 1,
    }),
    syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
      date: '2025-12-27',
      outcome: 'clean',
      record: null,
    }),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/utils/dateCoreUtils', async () => {
  const actual = await vi.importActual('@/utils/dateCoreUtils');
  return {
    ...actual,
    getTodayISO: () => '2025-12-27',
  };
});

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: mockDailyRecordRepositoryPort,
  defaultDailyRecordWritePort: {
    updatePartial: mockDailyRecordRepositoryPort.updatePartialDetailed,
    save: mockDailyRecordRepositoryPort.saveDetailed,
    delete: mockDailyRecordRepositoryPort.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordRepositoryPort.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: mockDailyRecordRepositoryPort,
}));

vi.mock('@/services/RepositoryContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/RepositoryContext')>();
  return {
    ...actual,
    useRepositories: () => ({
      dailyRecord: mockDailyRecordRepositoryPort,
    }),
  };
});

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({
    checkVersion: vi.fn(),
    currentVersion: 1,
    isOutdated: false,
  }),
}));

const mockExecuteSyncDailyRecord = vi.hoisted(() => vi.fn());

vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: mockExecuteSyncDailyRecord,
}));

import { UIProvider } from '@/context/UIContext';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createWrapper = () => {
  const { wrapper } = createQueryClientTestWrapper({
    wrapChildren: children => <UIProvider>{children}</UIProvider>,
  });
  return wrapper;
};

describe('definitive bed clear serialization', () => {
  const mockDate = '2025-12-27';
  const mockRecord: DailyRecord = DataFactory.createMockDailyRecord(mockDate, {
    beds: {},
    lastUpdated: '2026-01-01T00:00:00.000Z',
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockExecuteSyncDailyRecord.mockResolvedValue({
      success: true,
      data: { date: mockDate, outcome: 'clean', record: null },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const buildReadResult = (record: DailyRecord | null) => ({
    date: mockDate,
    record,
    source: record ? ('indexeddb' as const) : ('not_found' as const),
    compatibilityTier: 'none' as const,
    compatibilityIntensity: 'none' as const,
    migrationRulesApplied: [],
    consistencyState: record ? ('local_only' as const) : ('missing' as const),
    sourceOfTruth: record ? ('local' as const) : ('none' as const),
    retryability: 'not_applicable' as const,
    recoveryAction: 'none' as const,
    conflictSummary: null,
    observabilityTags: ['daily_record', 'read'],
    repairApplied: false,
  });

  it('serializes a newer mutation behind a definitive clear', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          rut: '11.111.111-1',
          pathology: 'Diagnóstico inicial',
        }),
      },
    });
    const clearedRecord = {
      ...occupiedRecord,
      beds: {
        ...occupiedRecord.beds,
        R1: DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          pathology: '',
          admissionDate: '',
        }),
      },
      lastUpdated: '2026-01-01T00:00:01.000Z',
    };
    const newerRecord = {
      ...occupiedRecord,
      beds: {
        ...occupiedRecord.beds,
        R1: {
          ...occupiedRecord.beds.R1,
          pathology: 'Diagnóstico más reciente',
        },
      },
      lastUpdated: '2026-01-01T00:00:02.000Z',
    };
    const clearWrite = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    const newerWrite = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    let remotelyVisibleRecord = occupiedRecord;

    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed)
      .mockImplementationOnce(() => clearWrite.promise)
      .mockImplementationOnce(() => newerWrite.promise);

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        { 'beds.R1': clearedRecord.beds.R1 },
        { consistency: 'remote_confirmed' }
      );
    });
    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1);
    });

    remotelyVisibleRecord = newerRecord;
    let newerPromise!: Promise<void>;
    act(() => {
      newerPromise = result.current.patchRecord({
        'beds.R1.pathology': 'Diagnóstico más reciente',
      });
    });
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1);
    expect(result.current.record?.beds.R1.pathology).toBe('Diagnóstico inicial');

    clearWrite.resolve(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord: clearedRecord,
      })
    );
    await act(async () => {
      await clearPromise;
    });
    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(2);
    });

    newerWrite.resolve(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord: newerRecord,
      })
    );
    await act(async () => {
      await newerPromise;
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente');
      expect(result.current.record?.beds.R1.pathology).toBe('Diagnóstico más reciente');
    });
  });

  it('does not replace a newer realtime census with an older confirmed write response', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente inicial',
          rut: '11.111.111-1',
        }),
      },
    });
    const confirmedClear = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: {
        ...occupiedRecord.beds,
        R1: DataFactory.createMockPatient('R1', { patientName: '', rut: '' }),
      },
    });
    const realtimeNewer = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: {
        ...occupiedRecord.beds,
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente nuevo',
          rut: '22.222.222-2',
        }),
      },
    });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );
    const testRuntime = createQueryClientTestWrapper({
      wrapChildren: children => <UIProvider>{children}</UIProvider>,
    });
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: testRuntime.wrapper,
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente inicial');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        { 'beds.R1': confirmedClear.beds.R1 },
        { consistency: 'remote_confirmed' }
      );
    });
    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
    });

    act(() => {
      testRuntime.queryClient.setQueryData(
        getDailyRecordQueryKey(mockDate),
        buildReadResult(realtimeNewer)
      );
    });
    write.resolve(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord: confirmedClear,
      })
    );

    await act(async () => {
      await clearPromise;
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente nuevo');
      expect(result.current.record?.lastUpdated).toBe('2026-01-01T00:00:02.000Z');
    });
  });

  it('rolls a failed later mutation back to the confirmed definitive clear', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          rut: '11.111.111-1',
          pathology: 'Diagnóstico inicial',
        }),
      },
    });
    const clearedRecord = {
      ...occupiedRecord,
      beds: {
        ...occupiedRecord.beds,
        R1: DataFactory.createMockPatient('R1', { patientName: '', rut: '', pathology: '' }),
      },
      lastUpdated: '2026-01-01T00:00:01.000Z',
    };
    const clearWrite = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    const newerWrite = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    let remotelyVisibleRecord = occupiedRecord;

    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed)
      .mockImplementationOnce(() => clearWrite.promise)
      .mockImplementationOnce(() => newerWrite.promise);

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        { 'beds.R1': DataFactory.createMockPatient('R1', { patientName: '', rut: '' }) },
        { consistency: 'remote_confirmed' }
      );
    });
    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1);
    });

    let newerPromise!: Promise<void>;
    act(() => {
      newerPromise = result.current.patchRecord({
        'beds.R1.pathology': 'Diagnóstico posterior',
      });
    });
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1);

    remotelyVisibleRecord = clearedRecord;
    clearWrite.resolve(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord: clearedRecord,
      })
    );
    await act(async () => {
      await clearPromise;
    });
    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(2);
    });

    newerWrite.reject(new Error('Fallo remoto posterior simulado'));
    await act(async () => {
      await expect(newerPromise).rejects.toThrow('Fallo remoto posterior simulado');
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('');
      expect(result.current.record?.beds.R1.pathology).toBe('');
    });
  });
});
