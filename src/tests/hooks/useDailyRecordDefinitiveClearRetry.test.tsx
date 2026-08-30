import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
    adoptAuthoritativeRecord: vi.fn(async record => record),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeDetailed: vi.fn(() => vi.fn()),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    syncWithFirestoreDetailed: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/utils/dateCoreUtils', async () => ({
  ...(await vi.importActual('@/utils/dateCoreUtils')),
  getTodayISO: () => '2025-12-27',
}));

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

vi.mock('@/services/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/RepositoryContext')>()),
  useRepositories: () => ({ dailyRecord: mockDailyRecordRepositoryPort }),
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), currentVersion: 1, isOutdated: false }),
}));

const mockExecuteSyncDailyRecord = vi.hoisted(() => vi.fn());
vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: mockExecuteSyncDailyRecord,
}));

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

const buildReadResult = (record: DailyRecord) => ({
  date: mockDate,
  record,
  source: 'indexeddb' as const,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'local_only' as const,
  sourceOfTruth: 'local' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});

const createWrapper = () =>
  createQueryClientTestWrapper({ wrapChildren: children => <UIProvider>{children}</UIProvider> })
    .wrapper;

describe('definitive bed clear conflict retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDailyRecordRepositoryPort.getForDateWithMeta.mockReset();
    mockDailyRecordRepositoryPort.getAuthoritativeForDate.mockReset();
    mockDailyRecordRepositoryPort.updatePartialDetailed.mockReset();
    mockExecuteSyncDailyRecord.mockResolvedValue({
      success: true,
      data: { date: mockDate, outcome: 'clean', record: null },
    });
    mockDailyRecordRepositoryPort.getAuthoritativeForDate.mockImplementation(async date => {
      const result = await mockDailyRecordRepositoryPort.getForDateWithMeta(date, true);
      return result.record;
    });
  });

  it('refreshes and retries once when the confirmed episode is still in the bed', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'ep-confirmed',
          admissionDate: '2025-12-26',
          pathology: 'Diagnóstico inicial',
        }),
      },
    });
    const refreshedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: {
        ...occupiedRecord.beds,
        R1: { ...occupiedRecord.beds.R1, pathology: 'Diagnóstico actualizado' },
      },
    });
    const clearedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...refreshedRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: {
        ...refreshedRecord.beds,
        R1: DataFactory.createMockPatient('R1', { patientName: '', rut: '' }),
      },
    });
    let remotelyVisibleRecord = occupiedRecord;
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed)
      .mockRejectedValueOnce(new ConcurrencyError('remote changed'))
      .mockImplementationOnce(async () => {
        remotelyVisibleRecord = clearedRecord;
        return createUpdatePartialDailyRecordResult({
          date: mockDate,
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
          confirmedRecord: clearedRecord,
        });
      });

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente')
    );
    remotelyVisibleRecord = refreshedRecord;

    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R1': clearedRecord.beds.R1 },
        {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: occupiedRecord.lastUpdated,
            confirmedOccupant: {
              clinicalEpisodeId: 'ep-confirmed',
              patientName: 'Paciente vigente',
              rut: '11.111.111-1',
              admissionDate: '2025-12-26',
            },
          },
        }
      );
    });

    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(2);
    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledWith(mockDate);
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenLastCalledWith(
      mockDate,
      expect.objectContaining({ 'beds.R1': expect.any(Object) }),
      expect.objectContaining({
        baseRecord: expect.objectContaining({ lastUpdated: refreshedRecord.lastUpdated }),
        intentionalBedClear: expect.objectContaining({
          confirmedLastUpdated: refreshedRecord.lastUpdated,
          confirmedOccupant: expect.objectContaining({ clinicalEpisodeId: 'ep-confirmed' }),
        }),
      })
    );
    await waitFor(() => expect(result.current.record?.beds.R1.patientName).toBe(''), {
      timeout: 3_000,
    });
  });

  it('does not retry a conflicted clear when the bed now contains another episode', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente confirmado',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'ep-confirmed',
        }),
      },
    });
    const replacementRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente reemplazante',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'ep-replacement',
        }),
      },
    });
    let remotelyVisibleRecord = occupiedRecord;
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente confirmado')
    );
    remotelyVisibleRecord = replacementRecord;

    await expect(
      act(async () => {
        await result.current.patchRecord(
          { 'beds.R1': DataFactory.createMockPatient('R1', { patientName: '', rut: '' }) },
          {
            intentionalBedClear: {
              bedId: 'R1',
              confirmedLastUpdated: occupiedRecord.lastUpdated,
              confirmedOccupant: {
                clinicalEpisodeId: 'ep-confirmed',
                patientName: 'Paciente confirmado',
                rut: '11.111.111-1',
              },
            },
          }
        );
      })
    ).rejects.toThrow('La cama cambió desde que se confirmó la limpieza');
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).not.toHaveBeenCalled();
    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledWith(mockDate);
  });

  it('does not retry when a crib was added after the parent-bed clear was confirmed', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente confirmado',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'ep-confirmed',
        }),
      },
    });
    const recordWithNewCrib = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: {
        R1: {
          ...occupiedRecord.beds.R1,
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            patientName: 'RN agregado',
            clinicalEpisodeId: 'new-crib-episode',
          }),
        },
      },
    });
    let remotelyVisibleRecord = occupiedRecord;
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente confirmado')
    );
    remotelyVisibleRecord = recordWithNewCrib;

    await expect(
      act(async () => {
        await result.current.patchRecord(
          { 'beds.R1': DataFactory.createMockPatient('R1', { patientName: '', rut: '' }) },
          {
            intentionalBedClear: {
              bedId: 'R1',
              confirmedLastUpdated: occupiedRecord.lastUpdated,
              confirmedOccupant: {
                clinicalEpisodeId: 'ep-confirmed',
                patientName: 'Paciente confirmado',
                rut: '11.111.111-1',
              },
              confirmedAssociatedCrib: null,
            },
          }
        );
      })
    ).rejects.toThrow('La cama cambió desde que se confirmó la limpieza');
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).not.toHaveBeenCalled();
    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledWith(mockDate);
  });
});
