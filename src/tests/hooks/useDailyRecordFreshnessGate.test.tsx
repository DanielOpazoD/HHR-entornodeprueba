import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { usePatchDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import { useDailyRecordFreshnessUi } from '@/hooks/useDailyRecordFreshnessUi';
import {
  ensureDailyRecordRemoteFreshness,
  markDailyRecordRemoteConfirmed,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
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
import { PatientStatus } from '@/types/domain/patientClassification';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';

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

describe('daily record remote freshness gate', () => {
  const date = '2026-05-16';

  beforeEach(() => {
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    vi.clearAllMocks();
  });

  it('blocks clinical editing silently after stale resume until the current record is confirmed', async () => {
    const { result } = renderHook(() => useDailyRecordFreshnessUi(date));

    expect(result.current.status).toBe('fresh_remote_confirmed');
    expect(result.current.isClinicalEditingBlocked).toBe(false);
    expect(result.current.messageLevel).toBe('none');

    act(() => {
      markDailyRecordTabHidden(0);
      markDailyRecordTabVisible(6 * 60 * 1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('stale_due_to_inactivity');
    });
    expect(result.current.isClinicalEditingBlocked).toBe(true);
    expect(result.current.isQuietlyRefreshing).toBe(true);
    expect(result.current.messageLevel).toBe('none');
    expect(result.current.userMessage).toBeUndefined();

    act(() => {
      markDailyRecordRemoteConfirmed(date, {
        source: 'query',
        confirmedAt: 6 * 60 * 1000 + 50,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('fresh_remote_confirmed');
    });
    expect(result.current.isClinicalEditingBlocked).toBe(false);
    expect(result.current.messageLevel).toBe('none');
    expect(result.current.userMessage).toBeUndefined();
  });

  it('hydrates a newer remote record before applying a clinical patch after stale resume', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);
    localRecord.beds.R1.pathology = 'Diagnostico local viejo';
    const remoteRecord: DailyRecord = {
      ...localRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...localRecord.beds,
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Diagnostico Firebase vigente',
        },
      },
    };

    let resolveRemoteRead: (value: ReturnType<typeof createDailyRecordReadResult>) => void;
    const remoteRead = new Promise<ReturnType<typeof createDailyRecordReadResult>>(resolve => {
      resolveRemoteRead = resolve;
    });
    vi.mocked(dailyRecord.getForDateWithMeta).mockReturnValue(remoteRead);
    vi.mocked(dailyRecord.updatePartialDetailed).mockResolvedValue(
      createUpdatePartialDailyRecordResult({
        date,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
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
    wrapper.displayName = 'DailyRecordFreshnessGateWrapper';

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        'beds.R1.status': PatientStatus.GRAVE,
      } as never);
    });

    await waitFor(() => {
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, true);
    });
    expect(dailyRecord.updatePartialDetailed).not.toHaveBeenCalled();

    await act(async () => {
      resolveRemoteRead!(
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
      await expect(mutationPromise).resolves.toBeDefined();
    });

    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledWith(
      date,
      {
        'beds.R1.status': PatientStatus.GRAVE,
      },
      expect.any(Object)
    );
    const [, , baseOptions] = vi.mocked(dailyRecord.updatePartialDetailed).mock.calls[0] ?? [];
    expect(baseOptions?.baseRecord?.lastUpdated).toBe('2026-05-16T10:30:00.000Z');
    expect(baseOptions?.baseRecord?.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
    expect(baseOptions?.baseRecord?.beds.R1.status).toBe('');
    const patchedRecord = queryClient.getQueryData<ReturnType<typeof createDailyRecordQueryResult>>(
      getDailyRecordQueryKey(date)
    )?.record;
    expect(patchedRecord?.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
    expect(patchedRecord?.beds.R1.status).toBe(PatientStatus.GRAVE);
  });

  it('blocks the clinical patch when Firebase cannot be confirmed after stale resume', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);
    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, localRecord, 'indexeddb', {
        consistencyState: 'local_authoritative',
        sourceOfTruth: 'local',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
        conflictSummary: {
          kind: 'remote_unavailable',
          sourceOfTruth: 'local',
          localTimestamp: localRecord.lastUpdated,
          message: 'No fue posible consultar Firebase.',
        },
        observabilityTags: ['daily_record', 'read', 'local_authoritative'],
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
        patchedFields: 1,
      })
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RepositoryProvider value={createRepositoryContainer({ dailyRecord })}>
          {children}
        </RepositoryProvider>
      </QueryClientProvider>
    );
    wrapper.displayName = 'DailyRecordFreshnessGateBlockedWrapper';

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });

    await expect(
      result.current.mutateAsync({
        'beds.R1.status': PatientStatus.GRAVE,
      } as never)
    ).rejects.toMatchObject({
      name: 'DailyRecordFreshnessGateError',
      message: 'Estamos verificando los últimos datos. Intente nuevamente en unos segundos.',
    });
    expect(dailyRecord.updatePartialDetailed).not.toHaveBeenCalled();
  });

  it('cancels the stale same-field attempt but allows a new edit after the refreshed record is visible', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);
    localRecord.beds.R1.pathology = 'Diagnostico local viejo';
    const remoteRecord: DailyRecord = {
      ...localRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...localRecord.beds,
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Diagnostico Firebase vigente',
        },
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
        patchedFields: 1,
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
    wrapper.displayName = 'DailyRecordFreshnessGateSameFieldWrapper';

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });

    await expect(
      result.current.mutateAsync({
        'beds.R1.pathology': 'Diagnostico usuario',
      } as never)
    ).rejects.toMatchObject({
      name: 'DailyRecordFreshnessGateError',
      message: 'El censo se actualizó hace un momento. Intente nuevamente para continuar.',
      presentation: 'silent',
    });
    expect(dailyRecord.updatePartialDetailed).not.toHaveBeenCalled();

    await result.current.mutateAsync({
      'beds.R1.pathology': 'Diagnostico usuario despues de ver remoto',
    } as never);
    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledWith(
      date,
      expect.objectContaining({
        'beds.R1.pathology': 'Diagnostico usuario despues de ver remoto',
      }),
      expect.any(Object)
    );
    const [, , baseOptions] = vi.mocked(dailyRecord.updatePartialDetailed).mock.calls[0] ?? [];
    expect(baseOptions?.baseRecord?.lastUpdated).toBe('2026-05-16T10:30:00.000Z');
    expect(baseOptions?.baseRecord?.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
  });

  it('requires a new remote confirmation when the previous freshness check is older than the threshold', async () => {
    const queryClient = createTestQueryClient();
    const firstRemoteRecord = DataFactory.createMockDailyRecord(date);
    firstRemoteRecord.lastUpdated = '2026-05-16T10:00:00.000Z';
    const secondRemoteRecord = {
      ...firstRemoteRecord,
      lastUpdated: '2026-05-16T10:06:00.000Z',
    };
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce(
        createDailyRecordQueryResult(firstRemoteRecord, {
          date,
          availabilityState: 'resolved',
          consistencyState: 'remote_authoritative',
          sourceOfTruth: 'remote',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record', 'read', 'remote_authoritative'],
          repairApplied: false,
        })
      )
      .mockResolvedValueOnce(
        createDailyRecordQueryResult(secondRemoteRecord, {
          date,
          availabilityState: 'resolved',
          consistencyState: 'remote_authoritative',
          sourceOfTruth: 'remote',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record', 'read', 'remote_authoritative'],
          repairApplied: false,
        })
      );

    await act(async () => {
      markDailyRecordTabHidden(0);
      markDailyRecordTabVisible(6 * 60 * 1000);
      await ensureDailyRecordRemoteFreshness({
        date,
        queryClient,
        queryFn,
        reason: 'clinical_patch',
        now: 6 * 60 * 1000,
      });
    });
    await ensureDailyRecordRemoteFreshness({
      date,
      queryClient,
      queryFn,
      reason: 'clinical_patch',
      now: 12 * 60 * 1000,
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('exposes field-level clinical locks after hydrating a newer remote record', async () => {
    const queryClient = createTestQueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);
    localRecord.beds.R1.pathology = 'Diagnostico local viejo';
    localRecord.beds.R1.status = PatientStatus.ESTABLE;
    const remoteRecord: DailyRecord = {
      ...localRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...localRecord.beds,
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Diagnostico Firebase vigente',
        },
      },
    };
    const queryFn = vi.fn().mockResolvedValue(
      createDailyRecordQueryResult(remoteRecord, {
        date,
        availabilityState: 'resolved',
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

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);
    await ensureDailyRecordRemoteFreshness({
      date,
      queryClient,
      queryFn,
      reason: 'clinical_patch',
      now: 6 * 60 * 1000,
    });

    const { result } = renderHook(() => useDailyRecordFreshnessUi(date));
    expect(result.current.status).toBe('fresh_remote_confirmed');
    expect(result.current.isClinicalEditingBlocked).toBe(false);
    expect(
      (
        result.current as {
          clinicalFieldLocksByBedId?: Record<string, { diagnosis?: boolean; status?: boolean }>;
        }
      ).clinicalFieldLocksByBedId?.R1?.diagnosis
    ).toBe(true);
    expect(
      (
        result.current as {
          clinicalFieldLocksByBedId?: Record<string, { diagnosis?: boolean; status?: boolean }>;
        }
      ).clinicalFieldLocksByBedId?.R1?.status
    ).not.toBe(true);
  });
});
