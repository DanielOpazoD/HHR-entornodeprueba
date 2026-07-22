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

describe('useRayenClinicalFill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('settles an applied run as partial when the single-flight guard rejects it', async () => {
    mocks.beginRayenFill.mockReturnValue(false);
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const onSettled = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
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

    expect(completeRun).toHaveBeenCalledWith(record, {
      total: 1,
      patched: 0,
      errors: [{ bedId: '*', source: 'patch', message: 'clinical_fill_busy' }],
    });
    expect(onSettled).toHaveBeenCalledOnce();
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
  });

  it('reports an explicit no-data nursing result in the same settled flow', async () => {
    const onStaffingProposal = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: ['Camila Soto'],
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
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun,
        onStaffingProposal: vi.fn(),
        onSettled: vi.fn(),
        createId: () => 'id',
      })
    );

    const fillPromise = result.current(record);
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    expect(mocks.endRayenFill).not.toHaveBeenCalled();

    resolveCompletion?.();
    await act(async () => fillPromise);
    expect(mocks.endRayenFill).toHaveBeenCalledWith(0, false);
  });

  it('settles as partial when run completion persistence fails', async () => {
    const record = {
      date: '2026-07-14',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
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
});
