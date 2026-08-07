import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
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

const confirmedHandoff = (record: DailyRecord) =>
  resolveConfirmedRayenCensusHandoff(
    {
      record,
      result: { date: record.date, outcome: 'clean' } as SaveDailyRecordResult,
    },
    { date: record.date, runId: record.rayenSync?.runId ?? '' }
  );

describe('useRayenClinicalFill confirmed census handoff', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
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
        onSettled: vi.fn(),
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
      nurseDayShift: ['Profesional vigente'],
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
        onSettled: vi.fn(),
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
        onSettled: vi.fn(),
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

  it('revalidates a locally stamped legacy record even when it contains policy evidence', async () => {
    const localRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-local-only'),
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(localRecord);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun: vi.fn().mockResolvedValue(undefined),
        onStaffingProposal: vi.fn(),
        onSettled: vi.fn(),
        createId: () => 'id',
      })
    );

    await act(async () => result.current(localRecord));

    expect(loadDailyRecord).toHaveBeenCalledOnce();
    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
  });

  it('keeps the applied run retryable after the fallback lacks frozen policy evidence', async () => {
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'run-without-event' },
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(record);
    const patchDailyRecord = vi.fn();
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord,
        patchDailyRecord,
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        onSettled,
        createId: () => 'id',
      })
    );

    await act(async () => result.current(record));

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(mocks.beginRayenFill).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('continues the clinical fill when one authoritative read exposes the applied run', async () => {
    const staleRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'run-persisted-later' },
    } as unknown as DailyRecord;
    const freshRecord = {
      ...staleRecord,
      ...legacyRunEvidence('run-persisted-later'),
    } as unknown as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(freshRecord);
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
        onSettled: vi.fn(),
        createId: () => 'id',
      })
    );

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
    const staleRecord = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'run-persisted-later' },
    } as unknown as DailyRecord;
    const freshRecord = {
      ...staleRecord,
      ...legacyRunEvidence('run-persisted-later'),
    } as unknown as DailyRecord;
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: vi.fn().mockResolvedValue(freshRecord),
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        onSettled: vi.fn(),
        createId: () => 'id',
      })
    );

    await act(async () => result.current(staleRecord));

    expect(completeRun).toHaveBeenCalledWith(
      freshRecord,
      expect.objectContaining({ total: 0, errors: [] }),
      expect.anything(),
      'run-persisted-later'
    );
  });
});
