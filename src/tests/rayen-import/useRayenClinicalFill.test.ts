import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import { mergeClinicalRetrySummary } from '@/features/rayen-import/domain/clinicalStageResolution';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';

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

const legacyRunEvidence = (runId = 'legacy-run') => ({
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

describe('useRayenClinicalFill', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('terminalizes an applied run when another fill already owns the shared progress slot', async () => {
    mocks.beginRayenFill.mockReturnValue(false);
    const completeRun = vi.fn().mockRejectedValue(new Error('audit unavailable'));
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence(),
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockResolvedValue(record),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: false, changed: false }),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(record);
    });

    expect(completeRun).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        total: 1,
        patched: 0,
        errors: [expect.objectContaining({ message: 'clinical_fill_busy' })],
      }),
      null,
      'legacy-run'
    );
    expect(clinicalResult).toEqual({
      status: 'failed',
      retry: expect.objectContaining({
        type: 'clinical_retry',
        pendingClinicalEpisodeIds: ['episode-1'],
      }),
    });
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
  });

  it('terminalizes an applied run when the fresh census cannot be loaded', async () => {
    const completeRun = vi.fn().mockRejectedValue(new Error('audit unavailable'));
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'run-load-failed' },
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockRejectedValue(new Error('offline')),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: false, changed: false }),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(record);
    });

    expect(completeRun).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        total: 1,
        patched: 0,
        errors: [expect.objectContaining({ message: 'clinical_record_load_failed' })],
      }),
      null,
      'run-load-failed'
    );
    expect(mocks.beginRayenFill).not.toHaveBeenCalled();
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
    expect(clinicalResult).toEqual({
      status: 'failed',
      retry: expect.objectContaining({
        type: 'clinical_retry',
        pendingClinicalEpisodeIds: ['episode-1'],
      }),
    });
  });

  it('reports an explicit no-data nursing result in the same settled flow', async () => {
    const onStaffingProposal = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence(),
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: ['Camila Soto'],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockResolvedValue(record),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun: vi.fn().mockResolvedValue(undefined),
        onStaffingProposal,
        createId: () => 'id',
      })
    );

    await act(async () => {
      await result.current(record);
    });

    expect(onStaffingProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        censusDate: '2026-07-14',
        day: expect.objectContaining({ names: [], ambiguous: false }),
        night: expect.objectContaining({ names: [], ambiguous: false }),
      }),
      7
    );
    expect(mocks.endRayenFill).toHaveBeenCalledWith(0, false);
  });

  it('does not publish terminal UI state until run completion persistence settles', async () => {
    let resolveCompletion: (() => void) | undefined;
    const completeRun = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveCompletion = resolve;
        })
    );
    const onStaffingProposal = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence(),
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockResolvedValue(record),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal,
        createId: () => 'id',
      })
    );

    const fillPromise = result.current(record);
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
    expect(onStaffingProposal).not.toHaveBeenCalled();

    resolveCompletion?.();
    await act(async () => fillPromise);
    expect(mocks.endRayenFill).toHaveBeenCalledWith(0, false);
    expect(onStaffingProposal).toHaveBeenCalledOnce();
  });

  it('settles as partial when run completion persistence fails', async () => {
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence(),
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockResolvedValue(record),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun: vi.fn().mockRejectedValue(new Error('audit unavailable')),
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    await act(async () => result.current(record));
    expect(mocks.endRayenFill).toHaveBeenCalledWith(0, true);
  });

  it('replaces retried failures while preserving aggregate evidence from the run', () => {
    const merged = mergeClinicalRetrySummary(
      {
        total: 2,
        patched: 1,
        errors: [
          { bedId: 'R2', source: 'patch', message: 'concurrent_write' },
          { bedId: '*', source: 'patch', message: 'temporary_summary' },
        ],
        incremental: {
          received: 3,
          newFacts: 2,
          duplicates: 1,
          corrections: 0,
          patientWrites: 1,
          historySnapshots: 1,
        },
      },
      {
        total: 1,
        patched: 1,
        errors: [],
        incremental: {
          received: 1,
          newFacts: 1,
          duplicates: 0,
          corrections: 0,
          patientWrites: 1,
          historySnapshots: 0,
        },
      },
      new Set(['R2'])
    );

    expect(merged).toMatchObject({
      total: 2,
      patched: 2,
      errors: [],
      incremental: {
        received: 4,
        newFacts: 3,
        duplicates: 1,
        patientWrites: 2,
        historySnapshots: 1,
      },
    });
  });

  it('does not count a clinically successful target twice when only audit completion is retried', () => {
    const merged = mergeClinicalRetrySummary(
      {
        total: 1,
        patched: 1,
        errors: [],
      },
      {
        total: 1,
        patched: 1,
        errors: [],
      },
      new Set(['R2'])
    );

    expect(merged).toMatchObject({ total: 1, patched: 1, errors: [] });
  });

});
