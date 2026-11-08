import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runner from '@/features/rayen-import/clinicalFillRunner';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type {
  ClinicalFillError,
  ClinicalFillSummary,
} from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { ClinicalStageResult } from '@/features/rayen-import/contracts/clinicalStageResult';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  beginRayenFill: vi.fn(() => true),
  endRayenFill: vi.fn(),
  getRayenFillAttemptId: vi.fn(() => 1),
  reportRayenFillProgress: vi.fn(),
  registerRayenFillAbort: vi.fn(),
}));

// A split day's view can re-read the day; by default these synthetic days have no documents.
const derived = vi.hoisted(() => ({ view: vi.fn() }));
const plainView = (day: unknown) => Promise.resolve({ record: day, day });
vi.mock('@/features/rayen-import/hooks/clinicalFillDerivedView', () => ({
  readClinicalFillDerivedView: derived.view,
}));

const RUN_ID = 'run-field-conflict';

const census = (revision: number, runId = RUN_ID): DailyRecord =>
  ({
    date: '2026-11-08',
    lastUpdated: `2026-11-08T10:00:0${revision}.000Z`,
    beds: Object.fromEntries(
      [1, 2, 3].map(index => [
        `R${index}`,
        {
          bedId: `R${index}`,
          patientName: `PACIENTE SINTÉTICO ${index}`,
          clinicalEpisodeId: `episode-${index}`,
          vitalSigns: { heartRate: index === 2 && revision > 1 ? 75 : 70 },
        },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    rayenSync: { runId },
    rayenSyncHistory: [
      {
        id: runId,
        status: 'applied',
        startedAt: '2026-11-08T10:00:00Z',
        by: 'Operador sintético',
        sourceDate: '2026-11-08',
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 },
      },
    ],
  }) as unknown as DailyRecord;

const fieldConflict = (episode: number): ClinicalFillError => ({
  bedId: `R${episode}`,
  clinicalEpisodeId: `episode-${episode}`,
  source: 'patch',
  reason: 'write_failed',
  cause: 'batch_field_changed',
  message: 'Un campo clínico cambió durante la sincronización.',
});

const firstAttempt = (errors: ClinicalFillError[]): ClinicalFillSummary => ({
  total: 3,
  patched: 3 - errors.filter(error => error.bedId !== '*').length,
  errors,
});

const render = () => {
  const completeRun = vi.fn().mockResolvedValue(undefined);
  const recordRunPerformance = vi.fn();
  // The run's base is revision 1; a newer value for the second patient is saved meanwhile.
  const loadDailyRecord = vi.fn().mockResolvedValueOnce(census(1)).mockResolvedValue(census(2));
  const { result } = renderHook(() =>
    useRayenClinicalFill({
      nurseCatalog: [],
      tensCatalog: [],
      loadDailyRecord,
      completeRun,
      onStaffingProposal: vi.fn(),
      createId: () => 'id',
      recordRunPerformance,
    })
  );
  const run = async () => {
    let outcome!: ClinicalStageResult;
    await act(async () => {
      outcome = await result.current(census(1));
    });
    return outcome;
  };
  return { run, completeRun, recordRunPerformance };
};

describe('clinical fill retry after a concurrent field change', () => {
  beforeEach(() => {
    setSessionGeneration('synthetic-generation-a');
    derived.view.mockReset().mockImplementation(plainView);
  });
  afterEach(() => {
    setSessionGeneration(null);
    vi.restoreAllMocks();
    resetRayenClinicalFillQueueForTests();
  });

  it('rewrites the left-out patient on a fresh read and completes the run', async () => {
    const fill = vi
      .spyOn(runner, 'runClinicalFill')
      .mockResolvedValueOnce(firstAttempt([fieldConflict(2)]))
      .mockResolvedValueOnce({ total: 1, patched: 1, errors: [] });
    const { run, completeRun, recordRunPerformance } = render();

    expect(await run()).toEqual({ status: 'complete' });

    expect(fill).toHaveBeenCalledTimes(2);
    const [retryRecord, , retryDeps] = fill.mock.calls[1]!;
    expect(retryRecord.beds.R2!.vitalSigns).toEqual({ heartRate: 75 });
    expect(retryDeps.allowedClinicalEpisodeIds).toEqual(['episode-2']);
    expect(retryDeps.archiveCudyrCapture).toBeUndefined();
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(completeRun.mock.calls[0]![1]).toMatchObject({ total: 3, patched: 3, errors: [] });
    expect(recordRunPerformance).toHaveBeenCalledTimes(1);
    expect(recordRunPerformance).toHaveBeenCalledWith(
      { coordination: { clinicalRetries: 1 } },
      RUN_ID
    );
  });

  it('retries once and leaves the patient pending when the field changes again', async () => {
    const fill = vi
      .spyOn(runner, 'runClinicalFill')
      .mockResolvedValueOnce(firstAttempt([fieldConflict(2)]))
      .mockResolvedValue({ total: 1, patched: 0, errors: [fieldConflict(2)] });
    const { run, completeRun, recordRunPerformance } = render();

    const outcome = await run();

    expect(fill).toHaveBeenCalledTimes(2);
    expect(recordRunPerformance).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledTimes(1);
    const summary = completeRun.mock.calls[0]![1] as ClinicalFillSummary;
    expect(summary).toMatchObject({ total: 3, patched: 2 });
    expect(summary.errors).toEqual([
      expect.objectContaining({ clinicalEpisodeId: 'episode-2', cause: 'batch_field_changed' }),
    ]);
    // Still on the existing manual retry path: a full read for the patient, and only the staffing
    // history for the rest of the census.
    expect(outcome).toEqual({
      status: 'partial',
      retry: expect.objectContaining({
        pendingHistoricalCudyrEpisodeIds: ['episode-2'],
        pendingReads: { 'episode-1': ['history'], 'episode-3': ['history'] },
      }),
    });
  });

  it('keeps census-wide issues that the retry does not redo', async () => {
    const archiveFailure: ClinicalFillError = {
      bedId: '*',
      source: 'cudyr',
      reason: 'historical_archive_failed',
      message: 'synthetic archive failure',
    };
    vi.spyOn(runner, 'runClinicalFill')
      .mockResolvedValueOnce(firstAttempt([fieldConflict(2), archiveFailure]))
      .mockResolvedValueOnce({ total: 1, patched: 1, errors: [] });
    const { run, completeRun } = render();

    await run();

    const summary = completeRun.mock.calls[0]![1] as ClinicalFillSummary;
    expect(summary).toMatchObject({ total: 3, patched: 3 });
    expect(summary.errors).toEqual([archiveFailure]);
  });

  it('keeps a patient pending when the retry recovers more than its field conflict', async () => {
    // The first history read failed for this patient, so its nurses are missing from the
    // census-wide staffing; the retry reads only this patient and cannot rebuild that inference.
    const historyFailure = (source: 'scales' | 'staffing'): ClinicalFillError => ({
      bedId: 'R2',
      clinicalEpisodeId: 'episode-2',
      source,
      reason: 'source_unavailable',
      message: 'synthetic history failure',
    });
    vi.spyOn(runner, 'runClinicalFill')
      .mockResolvedValueOnce(
        firstAttempt([historyFailure('scales'), historyFailure('staffing'), fieldConflict(2)])
      )
      .mockResolvedValueOnce({ total: 1, patched: 1, errors: [] });
    const { run, completeRun } = render();

    const outcome = await run();

    const summary = completeRun.mock.calls[0]![1] as ClinicalFillSummary;
    expect(summary.errors).toEqual([historyFailure('scales'), historyFailure('staffing')]);
    expect(outcome.status).toBe('partial');
  });

  it('does not retry on a day that the derived view re-read from a newer run', async () => {
    derived.view.mockImplementation((day: unknown) =>
      derived.view.mock.calls.length === 2 ? plainView(census(3, 'newer-run')) : plainView(day)
    );
    const fill = vi
      .spyOn(runner, 'runClinicalFill')
      .mockResolvedValue(firstAttempt([fieldConflict(2)]));
    const { run, recordRunPerformance } = render();

    await run();

    expect(derived.view).toHaveBeenCalledTimes(2);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(recordRunPerformance).not.toHaveBeenCalled();
  });

  it('stops without retrying when the session changes before the retry', async () => {
    const fill = vi.spyOn(runner, 'runClinicalFill').mockImplementationOnce(async () => {
      setSessionGeneration('synthetic-generation-b');
      return firstAttempt([fieldConflict(2)]);
    });
    const { run, completeRun, recordRunPerformance } = render();

    expect(await run()).toEqual({ status: 'failed' });

    expect(fill).toHaveBeenCalledTimes(1);
    expect(recordRunPerformance).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('does not retry a run without field conflicts', async () => {
    const fill = vi.spyOn(runner, 'runClinicalFill').mockResolvedValue(firstAttempt([]));
    const { run, completeRun, recordRunPerformance } = render();

    expect(await run()).toEqual({ status: 'complete' });

    expect(fill).toHaveBeenCalledTimes(1);
    expect(recordRunPerformance).not.toHaveBeenCalled();
    expect(completeRun).toHaveBeenCalledTimes(1);
  });
});
