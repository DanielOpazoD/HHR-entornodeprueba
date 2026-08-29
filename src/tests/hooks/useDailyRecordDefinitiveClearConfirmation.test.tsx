import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
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

describe('definitive bed clear confirmation', () => {
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
    mockDailyRecordRepositoryPort.getAuthoritativeForDate.mockImplementation(async date => {
      const result = await mockDailyRecordRepositoryPort.getForDateWithMeta(date, true);
      return result.record;
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

  it('keeps the patient visible until a definitive clear is remotely confirmed', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente a limpiar',
          rut: '11.111.111-1',
          pathology: 'Diagnóstico vigente',
        }),
      },
    });
    const clearedRecord = DataFactory.createMockDailyRecord(mockDate, {
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
      lastUpdated: '2026-01-01T00:00:02.000Z',
    });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    let remoteWriteConfirmed = false;

    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remoteWriteConfirmed ? clearedRecord : occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente a limpiar');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        {
          'beds.R1': clearedRecord.beds.R1,
        },
        {
          consistency: 'remote_confirmed',
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: occupiedRecord.lastUpdated,
            confirmedOccupant: {
              patientName: occupiedRecord.beds.R1.patientName,
              rut: occupiedRecord.beds.R1.rut,
              admissionDate: occupiedRecord.beds.R1.admissionDate,
            },
          },
        }
      );
    });

    await waitFor(() => {
      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
    });
    expect(result.current.record?.beds.R1.patientName).toBe('Paciente a limpiar');
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      { 'beds.R1': clearedRecord.beds.R1 },
      expect.objectContaining({
        baseRecord: expect.objectContaining({ date: mockDate }),
        intentionalBedClear: {
          bedId: 'R1',
          confirmedLastUpdated: occupiedRecord.lastUpdated,
          confirmedOccupant: expect.objectContaining({
            patientName: occupiedRecord.beds.R1.patientName,
            rut: occupiedRecord.beds.R1.rut,
          }),
        },
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
      })
    );

    remoteWriteConfirmed = true;
    write.resolve(
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
      expect(result.current.record?.beds.R1.patientName).toBe('');
    });
    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).not.toHaveBeenCalled();
  });

  it('forces remote confirmation whenever an intentional clear is declared', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          rut: '11.111.111-1',
        }),
      },
    });
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente');
    });

    await act(async () => {
      await result.current.patchRecord(
        {
          'beds.R1': DataFactory.createMockPatient('R1', { patientName: '', rut: '' }),
        },
        {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: occupiedRecord.lastUpdated,
            confirmedOccupant: {
              patientName: occupiedRecord.beds.R1.patientName,
              rut: occupiedRecord.beds.R1.rut,
              admissionDate: occupiedRecord.beds.R1.admissionDate,
            },
          },
        }
      );
    });

    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      expect.objectContaining({ 'beds.R1': expect.any(Object) }),
      expect.objectContaining({
        intentionalBedClear: {
          bedId: 'R1',
          confirmedLastUpdated: occupiedRecord.lastUpdated,
          confirmedOccupant: expect.objectContaining({
            patientName: occupiedRecord.beds.R1.patientName,
            rut: occupiedRecord.beds.R1.rut,
          }),
        },
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
      })
    );
  });

  it('keeps the patient visible if remote authority rejects the clear', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente protegido',
          rut: '11.111.111-1',
        }),
      },
    });
    const clearedBed = DataFactory.createMockPatient('R1', { patientName: '', rut: '' });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente protegido');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        { 'beds.R1': clearedBed },
        {
          consistency: 'remote_confirmed',
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: occupiedRecord.lastUpdated,
            confirmedOccupant: {
              patientName: occupiedRecord.beds.R1.patientName,
              rut: occupiedRecord.beds.R1.rut,
            },
          },
        }
      );
    });

    expect(result.current.record?.beds.R1.patientName).toBe('Paciente protegido');
    write.reject(new Error('remote unavailable'));

    await expect(clearPromise).rejects.toThrow('remote unavailable');
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente protegido');
    });
  });

  it('preserves the existing rollback for an ordinary optimistic patch failure', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          pathology: 'Diagnóstico original',
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

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.pathology).toBe('Diagnóstico original');
    });

    let patchPromise!: Promise<void>;
    act(() => {
      patchPromise = result.current.patchRecord({
        'beds.R1.pathology': 'Diagnóstico no confirmado',
      });
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.pathology).toBe('Diagnóstico no confirmado');
    });

    write.reject(new Error('remote unavailable'));
    await expect(patchPromise).rejects.toThrow('remote unavailable');
    await waitFor(() => {
      expect(result.current.record?.beds.R1.pathology).toBe('Diagnóstico original');
    });
  });
});
