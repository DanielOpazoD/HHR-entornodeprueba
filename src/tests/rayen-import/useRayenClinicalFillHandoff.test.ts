import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import {
  markRayenHistoricalCorrectionsPending,
  markRayenHistoricalCorrectionsRequireFreshCapture,
  resolveConfirmedRayenCensusHandoff,
} from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import {
  resolveClinicalFillDay,
  useRayenClinicalFill,
} from '@/features/rayen-import/hooks/useRayenClinicalFill';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

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

const confirmedHandoff = (record: DailyRecord, clinicalDay = record.date) =>
  resolveConfirmedRayenCensusHandoff(
    {
      record,
      result: { date: record.date, outcome: 'clean' } as SaveDailyRecordResult,
    },
    { date: record.date, clinicalDay, runId: record.rayenSync?.runId ?? '' }
  );

describe('useRayenClinicalFill confirmed census handoff', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('uses the clinical day frozen in the confirmed handoff', () => {
    const record = {
      date: '2026-07-15',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-historical'),
    } as unknown as DailyRecord;
    const handoff = confirmedHandoff(record, '2026-07-14');

    expect(resolveClinicalFillDay(handoff, record)).toBe('2026-07-14');
    expect(resolveClinicalFillDay(record, record)).toBe('2026-07-15');
  });

  it('uses the confirmed census handoff without a redundant policy read', async () => {
    const confirmedRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-confirmed'),
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn();
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    await act(async () => result.current(confirmedHandoff(confirmedRecord)));

    expect(loadDailyRecord).not.toHaveBeenCalled();
    expect(completeRun).toHaveBeenCalledWith(
      confirmedRecord,
      expect.any(Object),
      expect.anything(),
      'run-confirmed'
    );
  });

  it('keeps pending structural corrections out of the clinical result', async () => {
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-historical-pending'),
    } as unknown as DailyRecord;
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn(),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );
    const handoff = markRayenHistoricalCorrectionsPending(confirmedHandoff(record));

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(handoff);
    });

    expect(completeRun).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        errors: [],
      }),
      expect.anything(),
      'run-historical-pending',
      {
        retry: false,
        structuralReview: {
          historicalCorrectionsPending: true,
          historicalCorrectionsRequireFreshCapture: false,
          isolatedConflicts: 0,
        },
      }
    );
    expect(clinicalResult).toEqual({ status: 'complete' });
  });

  it('keeps fresh structural evidence requirements out of the clinical result', async () => {
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-historical-failed'),
    } as unknown as DailyRecord;
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn(),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );
    const handoff = markRayenHistoricalCorrectionsRequireFreshCapture(confirmedHandoff(record));

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(handoff);
    });

    expect(completeRun).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        errors: [],
      }),
      expect.anything(),
      'run-historical-failed',
      {
        retry: false,
        structuralReview: {
          historicalCorrectionsPending: false,
          historicalCorrectionsRequireFreshCapture: true,
          isolatedConflicts: 0,
        },
      }
    );
    expect(clinicalResult).toEqual({ status: 'complete' });
  });

  it('does not convert an isolated structural conflict into a clinical failure', async () => {
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-blocked' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-structural-conflict'),
    } as unknown as DailyRecord;
    const handoff = resolveConfirmedRayenCensusHandoff(
      {
        record,
        result: { date: record.date, outcome: 'clean' } as SaveDailyRecordResult,
      },
      {
        date: record.date,
        runId: 'run-structural-conflict',
        diff: {
          conflicts: [{ bedId: 'R1', reason: 'Identidad ambigua en la cama.' }],
        } as CensusImportDiff,
      }
    );
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn(),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    let clinicalResult;
    await act(async () => {
      clinicalResult = await result.current(handoff);
    });

    expect(completeRun).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        total: 0,
        errors: [],
      }),
      expect.anything(),
      'run-structural-conflict',
      {
        retry: false,
        structuralReview: {
          historicalCorrectionsPending: false,
          historicalCorrectionsRequireFreshCapture: false,
          isolatedConflicts: 1,
        },
      }
    );
    expect(clinicalResult).toEqual({ status: 'complete' });
  });

  it('revalidates a confirmed handoff once when the fill actually waited in the queue', async () => {
    let releaseFirstCompletion!: () => void;
    const firstRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-first'),
    } as unknown as DailyRecord;
    const queuedRecord = {
      ...firstRecord,
      ...legacyRunEvidence('run-queued'),
    } as unknown as DailyRecord;
    const authoritativeQueuedRecord = {
      ...queuedRecord,
      nursesDayShift: ['Profesional vigente'],
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(authoritativeQueuedRecord);
    const completeRun = vi.fn((record: DailyRecord) => {
      if (record.rayenSync?.runId !== 'run-first') return Promise.resolve();
      return new Promise<void>(resolve => {
        releaseFirstCompletion = resolve;
      });
    });
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    const firstFill = result.current(confirmedHandoff(firstRecord));
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    const queuedFill = result.current(confirmedHandoff(queuedRecord));
    expect(loadDailyRecord).not.toHaveBeenCalled();

    releaseFirstCompletion();
    await act(async () => Promise.all([firstFill, queuedFill]));

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
    expect(completeRun).toHaveBeenLastCalledWith(
      authoritativeQueuedRecord,
      expect.objectContaining({ total: 0 }),
      expect.anything(),
      'run-queued'
    );
  });

  it('keeps the revalidated record in a retry without losing the confirmed handoff', async () => {
    let releaseFirstCompletion!: () => void;
    const firstRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-first'),
    } as unknown as DailyRecord;
    const queuedRecord = {
      ...firstRecord,
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'Paciente',
          clinicalEpisodeId: 'episode-queued',
        },
      },
      ...legacyRunEvidence('run-queued'),
    } as unknown as DailyRecord;
    const authoritativeQueuedRecord = {
      date: queuedRecord.date,
      beds: queuedRecord.beds,
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'run-queued' },
      nursesDayShift: ['Profesional vigente'],
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(authoritativeQueuedRecord);
    const completeRun = vi.fn((record: DailyRecord) => {
      if (record.rayenSync?.runId === 'run-first') {
        return new Promise<void>(resolve => {
          releaseFirstCompletion = resolve;
        });
      }
      return Promise.resolve();
    });
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    const firstFill = result.current(confirmedHandoff(firstRecord));
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    const queuedHandoff = confirmedHandoff(queuedRecord);
    const queuedFill = result.current(queuedHandoff);

    releaseFirstCompletion();
    let queuedResult;
    await act(async () => {
      [, queuedResult] = await Promise.all([firstFill, queuedFill]);
    });

    expect(queuedResult).toEqual({
      status: 'failed',
      retry: expect.objectContaining({
        pendingClinicalEpisodeIds: ['episode-queued'],
        source: expect.objectContaining({
          record: authoritativeQueuedRecord,
          runId: 'run-queued',
        }),
      }),
    });
  });

  it('does not let a queued old run enrich a newer authoritative census', async () => {
    let releaseFirstCompletion!: () => void;
    const firstRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-first'),
    } as unknown as DailyRecord;
    const queuedRecord = {
      ...firstRecord,
      ...legacyRunEvidence('run-queued'),
    } as unknown as DailyRecord;
    const newerRecord = {
      ...queuedRecord,
      ...legacyRunEvidence('run-newer'),
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(newerRecord);
    const completeRun = vi.fn((record: DailyRecord) => {
      if (record.rayenSync?.runId !== 'run-first') return Promise.resolve();
      return new Promise<void>(resolve => {
        releaseFirstCompletion = resolve;
      });
    });
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );

    const firstFill = result.current(confirmedHandoff(firstRecord));
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    const queuedFill = result.current(confirmedHandoff(queuedRecord));

    releaseFirstCompletion();
    await act(async () => Promise.all([firstFill, queuedFill]));

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(mocks.beginRayenFill).toHaveBeenCalledTimes(1);
  });
});
