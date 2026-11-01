import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
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
  registerRayenFillAbort: vi.fn(),
}));

const enforcedRunEvidence = (runId = 'legacy-run') => ({
  rayenSync: { runId, at: '2026-07-14T10:00:00.000Z', by: 'SYNTHETIC A' },
  rayenSyncHistory: [
    {
      id: runId,
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador HHR',
      status: 'applied' as const,
      sourceDate: '2026-07-14',
      policy: { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 1 },
    },
  ],
});

describe('clinical phase session changes', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.beginRayenFill.mockReturnValue(true);
    mocks.getRayenFillAttemptId.mockReturnValue(7);
  });

  it('leaves the old run interrupted without completion writes or a retry token after session replacement', async () => {
    const completeRun = vi.fn();
    const onStaffingProposal = vi.fn();
    const record = {
      date: '2026-07-14',
      lastUpdated: '2026-07-14T10:00:00.000Z',
      activeExtraBeds: [],
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      ...enforcedRunEvidence(),
    } as DailyRecord;
    setSessionGeneration('synthetic-generation-a');
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        completeRun,
        onStaffingProposal,
        createId: () => 'id',
        loadDailyRecord: async () => {
          setSessionGeneration('synthetic-generation-b');
          return record;
        },
      })
    );
    try {
      await act(async () => {
        expect(await result.current(record)).toEqual({ status: 'failed' });
      });
      expect(completeRun).not.toHaveBeenCalled();
      expect(onStaffingProposal).not.toHaveBeenCalled();
      expect(mocks.beginRayenFill).not.toHaveBeenCalled();
    } finally {
      setSessionGeneration(null);
    }
  });
});
