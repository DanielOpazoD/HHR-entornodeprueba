import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { usePatchDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import {
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import {
  createDailyRecordQueryResult,
  createDailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const buildMockDailyRecordRepository = (): DailyRecordRepositoryPort => ({
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
  getAuthoritativeForDate: vi.fn(),
  getLocalForDate: vi.fn(),
  getLocalForDateWithMeta: vi.fn(),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  getAvailableDates: vi.fn(),
  getMonthRecords: vi.fn(),
  initializeDay: vi.fn(),
  save: vi.fn(),
  saveDetailed: vi.fn(),
  updatePartial: vi.fn(),
  updatePartialDetailed: vi.fn(),
  syncWithFirestoreDetailed: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  subscribeDetailed: vi.fn(() => vi.fn()),
  delete: vi.fn(),
  deleteDay: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
});

describe('daily record freshness gate full-bed move patches', () => {
  const date = '2026-05-16';

  beforeEach(() => {
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    vi.clearAllMocks();
  });

  it('allows a full-bed move patch after Firebase confirms the prior local move', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);
    localRecord.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente en R2',
      rut: '12.345.678-9',
      clinicalEpisodeId: 'episode-r2',
    });
    const remoteRecord: DailyRecord = {
      ...localRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...localRecord.beds,
        R2: { ...localRecord.beds.R2 },
      },
    };
    const movePatch = {
      'beds.R3': {
        ...localRecord.beds.R2,
        bedId: 'R3',
        location: localRecord.beds.R3.location,
      },
      'beds.R2': {
        ...localRecord.beds.R2,
        patientName: '',
        rut: '',
        clinicalEpisodeId: undefined,
      },
    };

    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, remoteRecord, 'firestore', {
        consistencyState: 'remote_authoritative',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: {
          kind: 'hydrated_from_remote',
          sourceOfTruth: 'remote',
          localTimestamp: localRecord.lastUpdated,
          remoteTimestamp: remoteRecord.lastUpdated,
        },
        observabilityTags: ['daily_record', 'read', 'remote_authoritative'],
        repairApplied: false,
      })
    );
    vi.mocked(dailyRecord.updatePartialDetailed).mockResolvedValue(
      createUpdatePartialDailyRecordResult({
        date,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 2,
      })
    );
    queryClient.setQueryData(
      getDailyRecordQueryKey(date),
      createDailyRecordQueryResult(localRecord, {
        date,
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      })
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RepositoryProvider value={createRepositoryContainer({ dailyRecord })}>
          {children}
        </RepositoryProvider>
      </QueryClientProvider>
    );
    wrapper.displayName = 'DailyRecordFullBedMoveFreshnessWrapper';

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(movePatch as never)).resolves.toBeDefined();
    });

    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledWith(
      date,
      movePatch,
      expect.objectContaining({
        baseRecord: expect.objectContaining({
          date,
          beds: expect.objectContaining({
            R2: expect.objectContaining({
              patientName: 'Paciente en R2',
              clinicalEpisodeId: 'episode-r2',
            }),
          }),
        }),
      })
    );
    expect(
      queryClient.getQueryData<ReturnType<typeof createDailyRecordQueryResult>>(
        getDailyRecordQueryKey(date)
      )?.record?.beds.R3.patientName
    ).toBe('Paciente en R2');
  });
});
