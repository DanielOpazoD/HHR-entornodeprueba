import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { DataFactory } from '@/tests/factories/DataFactory';
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
const buildReadResult = (record: DailyRecord): DailyRecordReadResult => ({
  date: mockDate,
  serverConfirmed: false,
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

describe('authoritative reads after rejected clears', () => {
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
});
