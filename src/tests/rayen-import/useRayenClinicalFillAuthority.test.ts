import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';

const mocks = vi.hoisted(() => ({
  beginRayenFill: vi.fn(),
  endRayenFill: vi.fn(),
  getRayenFillAttemptId: vi.fn(),
  reportRayenFillProgress: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  beginRayenFill: mocks.beginRayenFill,
  endRayenFill: mocks.endRayenFill,
  getRayenFillAttemptId: mocks.getRayenFillAttemptId,
  reportRayenFillProgress: mocks.reportRayenFillProgress,
}));

const legacyRunEvidence = (runId: string) => ({
  rayenSync: { runId },
  rayenSyncHistory: [
    {
      id: runId,
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador HHR',
      status: 'applied' as const,
      policy: { mode: 'preview' as const, revision: 1 },
    },
  ],
});

const createRecord = (runId: string, withEvidence = false) =>
  ({
    date: '2026-07-14',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    ...(withEvidence ? legacyRunEvidence(runId) : { rayenSync: { runId } }),
  }) as unknown as DailyRecord;

const renderClinicalFill = (overrides: Record<string, unknown> = {}) =>
  renderHook(() =>
    useRayenClinicalFill({
      nurseCatalog: [],
      tensCatalog: [],
      loadDailyRecord: vi.fn(),
      patchDailyRecord: vi.fn(),
      applyHistoricalCudyr: vi.fn(),
      completeRun: vi.fn().mockResolvedValue(undefined),
      onStaffingProposal: vi.fn(),
      createId: () => 'id',
      ...overrides,
    })
  );

describe('useRayenClinicalFill authority revalidation', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('revalidates a locally stamped legacy record even when it contains policy evidence', async () => {
    const localRecord = createRecord('run-local-only', true);
    const loadDailyRecord = vi.fn().mockResolvedValue(localRecord);
    const { result } = renderClinicalFill({ loadDailyRecord });

    await act(async () => result.current(localRecord));

    expect(loadDailyRecord).toHaveBeenCalledOnce();
    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
  });

  it('keeps the applied run retryable after the fallback lacks frozen policy evidence', async () => {
    const record = {
      ...createRecord('run-without-event'),
      beds: { R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' } },
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(record);
    const patchDailyRecord = vi.fn();
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderClinicalFill({
      loadDailyRecord,
      patchDailyRecord,
      completeRun,
    });

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(record);
    });

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(mocks.beginRayenFill).not.toHaveBeenCalled();
    expect(clinicalResult).toEqual({
      status: 'failed',
      retry: expect.objectContaining({
        pendingClinicalEpisodeIds: ['episode-1'],
      }),
    });
  });

  it('continues the clinical fill when one authoritative read exposes the applied run', async () => {
    const staleRecord = createRecord('run-persisted-later');
    const freshRecord = createRecord('run-persisted-later', true);
    const loadDailyRecord = vi.fn().mockResolvedValue(freshRecord);
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderClinicalFill({ loadDailyRecord, completeRun });

    await act(async () => result.current(staleRecord));

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledWith(
      freshRecord,
      expect.objectContaining({ total: 0, errors: [] }),
      expect.anything(),
      'run-persisted-later'
    );
  });

  it('resolves the frozen mode from the fresh authoritative run evidence', async () => {
    const staleRecord = createRecord('run-persisted-later');
    const freshRecord = createRecord('run-persisted-later', true);
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderClinicalFill({
      loadDailyRecord: vi.fn().mockResolvedValue(freshRecord),
      completeRun,
    });

    await act(async () => result.current(staleRecord));

    expect(completeRun).toHaveBeenCalledWith(
      freshRecord,
      expect.objectContaining({ total: 0, errors: [] }),
      expect.anything(),
      'run-persisted-later'
    );
  });
});
