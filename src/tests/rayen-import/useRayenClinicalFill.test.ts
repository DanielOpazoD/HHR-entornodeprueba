import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

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
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('terminalizes an applied run when another fill already owns the shared progress slot', async () => {
    mocks.beginRayenFill.mockReturnValue(false);
    const completeRun = vi.fn().mockRejectedValue(new Error('audit unavailable'));
    const onSettled = vi.fn();
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
        onSettled,
        createId: () => 'id',
      })
    );

    await act(async () => {
      await result.current(record);
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
    expect(onSettled).toHaveBeenCalledOnce();
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
  });

  it('terminalizes an applied run when the fresh census cannot be loaded', async () => {
    const completeRun = vi.fn().mockRejectedValue(new Error('audit unavailable'));
    const onSettled = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-load-failed'),
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
        onSettled,
        createId: () => 'id',
      })
    );

    await act(async () => result.current(record));

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
    expect(onSettled).toHaveBeenCalledOnce();
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
        onSettled: vi.fn(),
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
        onSettled: vi.fn(),
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
        onSettled: vi.fn(),
        createId: () => 'id',
      })
    );

    await act(async () => result.current(record));
    expect(mocks.endRayenFill).toHaveBeenCalledWith(0, true);
  });

  it('hydrates the latest census only when the queued task starts', async () => {
    const staleRecord = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente anterior', clinicalEpisodeId: 'episode-old' },
      },
      discharges: [],
      transfers: [],
      cma: [],
      ...legacyRunEvidence('run-old'),
    } as unknown as DailyRecord;
    const freshRecord = {
      ...staleRecord,
      beds: {},
      rayenSync: { runId: 'run-fresh' },
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

    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
    expect(completeRun).toHaveBeenCalledWith(
      freshRecord,
      expect.any(Object),
      expect.anything(),
      'run-old'
    );
  });

  it('keeps the applied run retryable without falling back when frozen policy evidence is unavailable', async () => {
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

    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(mocks.beginRayenFill).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
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
