import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

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

describe('definitive clear first-attempt reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPendingDailyRecordPatchesForTests();
  });

  it.each(['before-clear', 'after-clear', 'after-clear-with-moved-episode'] as const)(
    'keeps the authoritative occupant after rejection when a local read resolves %s',
    async phase => {
      let hydrate = () => {};
      vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
        hydrate = () => callback({ didTimeout: false, timeRemaining: () => 50 });
        return 1;
      });
      vi.stubGlobal('cancelIdleCallback', vi.fn());
      const local = DataFactory.createMockDailyRecord(mockDate, {
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'local-episode',
            pathology: 'Accepted local work',
          }),
          R2: DataFactory.createMockPatient('R2', {
            clinicalEpisodeId: 'unrelated-episode',
            rut: '22.222.222-2',
            patientName: 'Otra persona sintética',
            pathology: 'Independent pending work',
          }),
        },
      });
      const remote = {
        ...local,
        beds: {
          R1: {
            ...local.beds.R1,
            clinicalEpisodeId: 'remote-episode',
            pathology: 'Remote occupant diagnosis',
          },
          R2: { ...local.beds.R2, pathology: 'Older remote diagnosis' },
          ...(phase === 'after-clear-with-moved-episode'
            ? { R3: { ...local.beds.R1, bedId: 'R3', pathology: 'Original remote diagnosis' } }
            : {}),
        },
      };
      mockDailyRecordRepositoryPort.getForDateWithMeta.mockResolvedValue(buildReadResult(local));
      mockDailyRecordRepositoryPort.getAuthoritativeForDate.mockResolvedValue(remote);
      registerPendingDailyRecordPatch(mockDate, { 'beds.R1.pathology': 'Accepted local work' });
      registerPendingDailyRecordPatch(mockDate, {
        'beds.R2.pathology': 'Independent pending work',
      });
      const { wrapper, queryClient } = createQueryClientTestWrapper({
        wrapChildren: children => <UIProvider>{children}</UIProvider>,
      });
      const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
        wrapper,
      });
      await waitFor(() =>
        expect(result.current.record?.beds.R1.clinicalEpisodeId).toBe('local-episode')
      );
      const finishBackgroundRead = async () => {
        await act(async () => hydrate());
        await act(async () => {
          await queryClient.refetchQueries({ queryKey: getDailyRecordQueryKey(mockDate) });
        });
        await waitFor(() => {
          expect(mockDailyRecordRepositoryPort.getForDateWithMeta).toHaveBeenCalledWith(
            mockDate,
            true
          );
          expect(queryClient.getQueryState(getDailyRecordQueryKey(mockDate))?.fetchStatus).toBe(
            'idle'
          );
        });
      };
      if (phase === 'before-clear') await finishBackgroundRead();
      await act(async () => {
        await expect(
          result.current.patchRecord(
            { 'beds.R1.patientName': '', 'beds.R1.pathology': '' },
            {
              intentionalBedClear: {
                bedId: 'R1',
                confirmedLastUpdated: local.lastUpdated,
                confirmedOccupant: { clinicalEpisodeId: 'local-episode' },
              },
            }
          )
        ).rejects.toBeInstanceOf(ConcurrencyError);
      });
      await waitFor(() =>
        expect(result.current.record?.beds.R1.clinicalEpisodeId).toBe('remote-episode')
      );
      if (phase !== 'before-clear') await finishBackgroundRead();
      await waitFor(() =>
        expect(result.current.record?.beds.R1.clinicalEpisodeId).toBe('remote-episode')
      );
      expect(result.current.record?.beds.R1.pathology).toBe('Remote occupant diagnosis');
      expect(result.current.record?.beds.R2.pathology).toBe('Independent pending work');
      if (phase === 'after-clear-with-moved-episode') {
        expect(result.current.record?.beds.R3.patientName).toBe(local.beds.R1.patientName);
        expect(result.current.record?.beds.R3.pathology).toBe('Accepted local work');
      }
      expect(mockDailyRecordRepositoryPort.updatePartialDetailed).not.toHaveBeenCalled();
      const olderLocal = {
        ...local,
        beds: { ...local.beds, R1: { ...local.beds.R1, pathology: 'Older local work' } },
      };
      expect(applyPendingExplicitCensusPatch(mockDate, olderLocal, local).beds.R1.pathology).toBe(
        'Accepted local work'
      );
    }
  );
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

  it('starts a clear from the current remote revision while keeping the visible update optimistic', async () => {
    const displayedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente vigente',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'ep-confirmed',
          pathology: 'Diagnóstico visible',
        }),
      },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...displayedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: { R1: { ...displayedRecord.beds.R1, pathology: 'Diagnóstico remoto reciente' } },
    });
    const clearedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...authoritativeRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          pathology: '',
          admissionDate: '',
        }),
      },
    });
    let remotelyVisibleRecord = displayedRecord;
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      async () => {
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
      }
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente')
    );
    remotelyVisibleRecord = authoritativeRecord;

    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R1': clearedRecord.beds.R1 },
        {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: displayedRecord.lastUpdated,
            confirmedOccupant: {
              clinicalEpisodeId: 'ep-confirmed',
              patientName: 'Paciente vigente',
              rut: '11.111.111-1',
            },
          },
        }
      );
    });

    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledOnce();
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      expect.objectContaining({ 'beds.R1': expect.any(Object) }),
      expect.objectContaining({
        baseRecord: expect.objectContaining({ lastUpdated: authoritativeRecord.lastUpdated }),
        intentionalBedClear: expect.objectContaining({
          confirmedLastUpdated: authoritativeRecord.lastUpdated,
          confirmedOccupant: expect.objectContaining({ clinicalEpisodeId: 'ep-confirmed' }),
        }),
      })
    );
    await waitFor(() => expect(result.current.record?.beds.R1.patientName).toBe(''));
  });

  it('clears an attached crib on the first click when only the displayed revision is stale', async () => {
    const displayedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            patientName: 'Paciente principal',
            clinicalEpisodeId: 'parent-episode',
            pathology: 'Edición local pendiente',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            patientName: 'RN vigente',
            clinicalEpisodeId: 'crib-episode',
          }),
        },
      },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...displayedRecord,
      lastUpdated: '2026-01-01T00:00:01.000Z',
      beds: {
        R1: {
          ...displayedRecord.beds.R1,
          pathology: 'Dato remoto reciente del paciente principal',
        },
      },
    });
    const clearedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...authoritativeRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: { R1: { ...authoritativeRecord.beds.R1, clinicalCrib: undefined } },
    });
    let remotelyVisibleRecord = displayedRecord;
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockImplementation(async () =>
      buildReadResult(remotelyVisibleRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      async () => {
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
      }
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.clinicalCrib?.patientName).toBe('RN vigente')
    );
    remotelyVisibleRecord = authoritativeRecord;

    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R1.clinicalCrib': null },
        {
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: displayedRecord.lastUpdated,
            confirmedOccupant: {
              clinicalEpisodeId: 'crib-episode',
              patientName: 'RN vigente',
            },
          },
        }
      );
    });

    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledOnce();
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      { 'beds.R1.clinicalCrib': null },
      expect.objectContaining({
        baseRecord: expect.objectContaining({ lastUpdated: authoritativeRecord.lastUpdated }),
        intentionalBedClear: expect.objectContaining({
          target: 'clinicalCrib',
          confirmedLastUpdated: authoritativeRecord.lastUpdated,
        }),
      })
    );
    await waitFor(() => expect(result.current.record?.beds.R1.clinicalCrib).toBeUndefined());
  });

  it('removes a local crib ghost when the repository confirms it is already absent remotely', async () => {
    const localRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            patientName: 'Paciente principal',
            clinicalEpisodeId: 'parent-episode',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            patientName: 'RN local pendiente',
            clinicalEpisodeId: 'crib-local',
          }),
        },
      },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...localRecord,
      lastUpdated: '2026-01-01T00:00:05.000Z',
      nursesDayShift: ['Turno remoto vigente'],
      beds: {
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Versión remota anterior',
          clinicalCrib: undefined,
        },
      },
    });
    const localProjection = DataFactory.createMockDailyRecord(mockDate, {
      ...authoritativeRecord,
      lastUpdated: '2026-01-01T00:00:06.000Z',
      beds: {
        R1: {
          ...authoritativeRecord.beds.R1,
          pathology: 'Edición local pendiente',
        },
      },
    });
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(localRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).mockResolvedValue(
      authoritativeRecord
    );
    vi.mocked(defaultDailyRecordRepositoryPort.adoptAuthoritativeRecord).mockResolvedValueOnce(
      localProjection
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.clinicalCrib?.patientName).toBe('RN local pendiente')
    );

    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R1.clinicalCrib': null },
        {
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: localRecord.lastUpdated,
            confirmedOccupant: {
              clinicalEpisodeId: 'crib-local',
              patientName: 'RN local pendiente',
            },
          },
        }
      );
    });

    await waitFor(() => expect(result.current.record?.beds.R1.clinicalCrib).toBeUndefined());
    expect(result.current.record?.beds.R1.pathology).toBe('Edición local pendiente');
    expect(result.current.record?.nursesDayShift).toEqual(['Turno remoto vigente']);
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).not.toHaveBeenCalled();
    expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledOnce();
    expect(defaultDailyRecordRepositoryPort.adoptAuthoritativeRecord).toHaveBeenCalledWith(
      authoritativeRecord,
      { 'beds.R1.clinicalCrib': null }
    );
  });

  it.each(['before-write', 'after-conflict'])(
    'adopts an already-applied clear with different slot metadata (%s)',
    async phase => {
      const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
        ...mockRecord,
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente vigente',
            rut: '11.111.111-1',
            clinicalEpisodeId: 'ep-confirmed',
          }),
        },
      });
      const clearedRecord = DataFactory.createMockDailyRecord(mockDate, {
        ...occupiedRecord,
        lastUpdated: '2026-01-01T00:00:02.000Z',
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            patientName: '',
            rut: '',
            pathology: '',
            admissionDate: '',
          }),
        },
      });
      vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
        buildReadResult(occupiedRecord)
      );
      if (phase === 'after-conflict') {
        vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate)
          .mockResolvedValueOnce(occupiedRecord)
          .mockResolvedValueOnce(clearedRecord);
      } else {
        vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).mockResolvedValue(
          clearedRecord
        );
      }
      vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockRejectedValueOnce(
        new ConcurrencyError('response lost after remote commit')
      );

      const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
        wrapper: createWrapper(),
      });
      await waitFor(() =>
        expect(result.current.record?.beds.R1.patientName).toBe('Paciente vigente')
      );

      await act(async () => {
        await result.current.patchRecord(
          { 'beds.R1': { ...clearedRecord.beds.R1, location: 'Ubicación local antigua' } },
          {
            intentionalBedClear: {
              bedId: 'R1',
              confirmedLastUpdated: occupiedRecord.lastUpdated,
              confirmedOccupant: {
                clinicalEpisodeId: 'ep-confirmed',
                patientName: 'Paciente vigente',
                rut: '11.111.111-1',
              },
            },
          }
        );
      });

      expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(
        phase === 'after-conflict' ? 1 : 0
      );
      expect(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).toHaveBeenCalledTimes(
        phase === 'after-conflict' ? 2 : 1
      );
      expect(defaultDailyRecordRepositoryPort.adoptAuthoritativeRecord).toHaveBeenCalledWith(
        clearedRecord,
        { 'beds.R1': clearedRecord.beds.R1 }
      );
      await waitFor(() => expect(result.current.record?.beds.R1.patientName).toBe(''));
      expect(result.current.record?.beds.R1.location).toBe(clearedRecord.beds.R1.location);
    }
  );
});
