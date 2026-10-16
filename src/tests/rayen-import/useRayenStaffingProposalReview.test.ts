import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenStaffingProposalReview } from '@/features/rayen-import/hooks/useRayenStaffingProposalReview';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  register: vi.fn(async items => items),
  outcome: vi.fn(),
  generation: 'session-a',
}));
vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  requestHistoryScales: mocks.history,
}));
vi.mock('@/services/staff/eloisaStaffRegistry', () => ({ registerEloisaStaff: mocks.register }));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  reportRayenStaffingOutcome: mocks.outcome,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => mocks.generation,
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const day = (date: string) =>
  DataFactory.createMockDailyRecord(date, {
    beds: { R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'synthetic-episode' }) },
  });
const first = day('2026-10-14');
const second = day('2026-10-15');
const setup = (
  load = vi.fn(async (date: string): Promise<DailyRecord> => (date === first.date ? first : second))
) => {
  const currentRecordRef = { current: first };
  const view = renderHook(
    ({ currentRecord }) => {
      currentRecordRef.current = currentRecord;
      return useRayenStaffingProposalReview({
        currentRecord,
        currentRecordRef,
        isAdmin: true,
        nurseCatalog: [],
        tensCatalog: [],
        loadFreshClinicalRecord: load,
      });
    },
    { initialProps: { currentRecord: first } }
  );
  return { ...view, load };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 'session-a';
  mocks.history.mockResolvedValue({ events: [], nursingActivity: [] });
});

describe('staffing review ownership', () => {
  it('allows the new day to start immediately and ignores an old rejection', async () => {
    const old = deferred<DailyRecord>();
    const load = vi.fn(async (date: string) => (date === first.date ? old.promise : second));
    const { result, rerender } = setup(load);
    let previous!: Promise<unknown>;
    act(() => {
      previous = result.current.refreshStaffingProposal();
    });
    rerender({ currentRecord: second });
    await act(async () => {
      await result.current.refreshStaffingProposal();
    });
    expect(load).toHaveBeenCalledWith(second.date);
    const error = result.current.staffingProposalError;
    await act(async () => {
      old.reject(new Error('old failure'));
      await previous;
    });
    expect(result.current.staffingProposalError).toBe(error);
    expect(result.current.isStaffingProposalBusy).toBe(false);
  });

  it('does not read history or register staff after the session is replaced during the initial read', async () => {
    const pending = deferred<DailyRecord>();
    const { result } = setup(vi.fn(() => pending.promise));
    let review!: Promise<unknown>;
    act(() => {
      review = result.current.refreshStaffingProposal();
    });
    mocks.generation = 'session-b';
    await act(async () => {
      pending.resolve(first);
      await review;
    });
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
    expect(result.current.staffingProposalError).toBeNull();
  });

  it('aborts outstanding bridge reads on unmount without publishing their result', async () => {
    const history = deferred<{ events: never[]; nursingActivity: never[] }>();
    mocks.history.mockReturnValue(history.promise);
    const { result, unmount } = setup();
    let review!: Promise<unknown>;
    await act(async () => {
      review = result.current.refreshStaffingProposal();
    });
    const signal = mocks.history.mock.calls[0]?.[4] as AbortSignal | undefined;
    unmount();
    expect(signal?.aborted).toBe(true);
    history.resolve({ events: [], nursingActivity: [] });
    await review;
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

  it('does not release a newer review when the previous day finishes late', async () => {
    const old = deferred<DailyRecord>();
    const next = deferred<DailyRecord>();
    const { result, rerender } = setup(
      vi.fn(date => (date === first.date ? old.promise : next.promise))
    );
    let previous!: Promise<unknown>;
    let current!: Promise<unknown>;
    act(() => {
      previous = result.current.refreshStaffingProposal();
    });
    rerender({ currentRecord: second });
    act(() => {
      current = result.current.refreshStaffingProposal();
    });
    await act(async () => {
      old.resolve(first);
      await previous;
    });
    expect(result.current.isStaffingProposalBusy).toBe(true);
    await act(async () => {
      next.resolve(second);
      await current;
    });
    expect(result.current.isStaffingProposalBusy).toBe(false);
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it('blocks a retained callback after its owner is unmounted', async () => {
    const { result, unmount, load } = setup();
    const refresh = result.current.refreshStaffingProposal;
    unmount();
    expect(await refresh()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('completes a current review and releases its busy state', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.refreshStaffingProposal();
    });
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(result.current.isStaffingProposalBusy).toBe(false);
    expect(result.current.staffingProposalError).toBe(
      'No hay cambios de dotación pendientes de revisión.'
    );
  });
});
