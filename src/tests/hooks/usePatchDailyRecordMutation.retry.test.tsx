import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as freshnessController from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';
import { Specialty } from '@/types/domain/patientClassification';

vi.mock('@/services/utils/featureFlags', () => ({
  isFeatureEnabled: (flag: string) => flag === 'SPECIALTY_EPISODE_ASSIGNMENT',
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

describe('daily record patch retry ownership', () => {
  beforeEach(() => {
    resetDailyRecordFreshnessGateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps handoff bound to the displayed patient when freshness returns another occupant', async () => {
    const date = '2026-05-16';
    const displayed = DataFactory.createMockDailyRecord(date);
    displayed.beds.R1 = {
      ...displayed.beds.R1,
      clinicalEpisodeId: 'synthetic-episode-A',
      patientName: 'Paciente A Sintético',
    };
    const replacement = {
      ...displayed,
      beds: {
        ...displayed.beds,
        R1: {
          ...displayed.beds.R1,
          clinicalEpisodeId: 'synthetic-episode-B',
          patientName: 'Paciente B Sintético',
        },
      },
    };
    const runtime = {
      date,
      availabilityState: 'resolved',
      consistencyState: 'remote_authoritative',
      sourceOfTruth: 'remote',
      retryability: 'not_applicable',
      recoveryAction: 'none',
      conflictSummary: null,
      observabilityTags: ['daily_record', 'read'],
      repairApplied: false,
    } as const;
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      getDailyRecordQueryKey(date),
      createDailyRecordQueryResult(displayed, {
        ...runtime,
        observabilityTags: [...runtime.observabilityTags],
      })
    );
    vi.spyOn(freshnessController, 'ensureFreshClinicalPatchMutation').mockResolvedValue(
      createDailyRecordQueryResult(replacement, {
        ...runtime,
        observabilityTags: [...runtime.observabilityTags],
      })
    );
    const dailyRecord = buildMockDailyRecordRepository();
    const conflict = new ConcurrencyError(
      'El paciente de R1 cambió. Recarga.',
      'semantic_conflict'
    );
    vi.mocked(dailyRecord.updatePartialDetailed).mockImplementation(async () => {
      expect(
        queryClient.getQueryData<{ record: typeof displayed }>(getDailyRecordQueryKey(date))?.record
          .beds.R1.medicalHandoffNote
      ).not.toBe('Nota de A sintético');
      throw conflict;
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RepositoryProvider value={createRepositoryContainer({ dailyRecord })}>
          {children}
        </RepositoryProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
    const partial = { 'beds.R1.medicalHandoffNote': 'Nota de A sintético' };
    await act(async () => {
      await expect(result.current.mutateAsync(partial)).rejects.toBe(conflict);
    });
    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledWith(
      date,
      partial,
      expect.objectContaining({
        baseRecord: expect.objectContaining({
          beds: expect.objectContaining({
            R1: expect.objectContaining({ clinicalEpisodeId: 'synthetic-episode-A' }),
          }),
        }),
      })
    );
    expect(
      queryClient.getQueryData<{ record: typeof displayed }>(getDailyRecordQueryKey(date))?.record
        .beds.R1.medicalHandoffNote
    ).not.toBe('Nota de A sintético');
    queryClient.clear();
  });

  it.each([
    [
      'permission rejection',
      Object.assign(new Error('Not authorized'), { code: 'permission-denied' }),
    ],
    ['semantic conflict', new ConcurrencyError('The specialty decision changed')],
  ])('returns false after one %s despite a global mutation retry policy', async (_label, error) => {
    const date = '2026-05-16';
    const record = DataFactory.createMockDailyRecord(date);
    record.beds.R1 = {
      ...record.beds.R1,
      specialty: Specialty.MEDICINA,
      clinicalEpisodeId: 'synthetic-episode-r1',
    };
    const dailyRecord = buildMockDailyRecordRepository();
    vi.mocked(dailyRecord.updatePartialDetailed).mockRejectedValue(error);
    const queryClient = createTestQueryClient({
      defaultOptions: { mutations: { retry: 1, retryDelay: 0 } },
    });
    queryClient.setQueryData(
      getDailyRecordQueryKey(date),
      createDailyRecordQueryResult(record, {
        date,
        availabilityState: 'resolved',
        consistencyState: 'remote_authoritative',
        sourceOfTruth: 'remote',
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
    wrapper.displayName = 'PatchRetryOwnershipWrapper';
    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });

    await act(async () => {
      await expect(
        executeBedManagementAction({
          currentRecord: record,
          action: {
            type: 'UPDATE_PATIENT_MULTIPLE',
            bedId: 'R1',
            fields: { specialty: Specialty.CIRUGIA },
          },
          validation: { processFieldValue: (_field, value) => ({ valid: true, value }) },
          bedAudit: {
            auditPatientChange: vi.fn(),
            auditCudyrChange: vi.fn(),
            auditCribCudyrChange: vi.fn(),
            auditPatientCleared: vi.fn(),
            auditPatientModified: vi.fn(),
            auditPatientMovement: vi.fn(),
          },
          patchRecord: async (partial, options) => {
            await result.current.mutateAsync({
              partial,
              options: {
                requireConfirmedRecord: true,
                requireRemoteAuthorityFirst: true,
                requireAtomicCas: true,
                specialtyIntent: options?.specialtyIntent,
              },
            });
          },
        })
      ).resolves.toBe(false);
    });

    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledTimes(1);
    expect(dailyRecord.updatePartialDetailed).toHaveBeenCalledWith(
      date,
      { 'beds.R1.specialty': Specialty.CIRUGIA },
      expect.objectContaining({
        specialtyIntent: expect.objectContaining({
          kind: 'manual',
          episodeId: 'synthetic-episode-r1',
          value: Specialty.CIRUGIA,
        }),
      })
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.error).toBe(error);
    queryClient.clear();
  });
});
