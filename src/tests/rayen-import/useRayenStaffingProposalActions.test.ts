import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useRayenStaffingProposalActions } from '@/features/rayen-import/hooks/useRayenStaffingProposalActions';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { NursingStaffingProposal } from '@/features/rayen-import/contracts/nursingShiftInference';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  ensureFresh: vi.fn(),
  reportOutcome: vi.fn(),
}));

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  ensureFreshDailyRecordQuery: mocks.ensureFresh,
  patchDailyRecordWithCompatibility: mocks.patch,
}));
vi.mock('@/features/rayen-import/domain/applyNursingShiftProposal', () => ({
  reconcileNursingShiftProposal: (_record: unknown, proposal: unknown) => proposal,
  buildNursingShiftProposalPatch: () => ({ nursesDayShift: ['ENFERMERA SINTETICA'] }),
}));
vi.mock('@/shared/access/censusDayWriteAccessPolicy', () => ({
  canWriteCensusDay: () => true,
}));
vi.mock('@/features/rayen-import/domain/nursingStaffingCollectionContext', () => ({
  isNursingStaffingCollectionContextCurrent: () => true,
}));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  reportRayenStaffingOutcome: mocks.reportOutcome,
}));

/**
 * Applying the staffing proposal Rayen read (W14-D1-5b): a write the census cannot continue on
 * keeps the proposal open with the write's own message; a write that lands closes it.
 */
const DATE = '2026-11-17';
const day = DataFactory.createMockDailyRecord(DATE, { lastUpdated: '2026-11-17T08:00:00.000Z' });
const proposal = {
  censusDate: DATE,
  sourceLastUpdated: day.lastUpdated,
} as NursingStaffingProposal;

const renderActions = () => {
  const setProposal = vi.fn();
  const setError = vi.fn();
  const { result } = renderHook(() =>
    useRayenStaffingProposalActions({
      proposal,
      setProposal,
      isBusy: false,
      setIsBusy: vi.fn(),
      setError,
      currentRecordRef: { current: day },
      isAdmin: false,
      dailyRecord: buildMockDailyRecordRepository(),
      queryClient: new QueryClient(),
    })
  );
  return { confirm: result.current.confirm, setProposal, setError };
};

const write = (result: DailyRecordWriteResult) => result;

describe('useRayenStaffingProposalActions: applying the proposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureFresh.mockResolvedValue({ record: day });
  });

  it('a write refused for review keeps the proposal open with its message', async () => {
    mocks.patch.mockResolvedValue(
      write({
        date: DATE,
        savedHere: true,
        state: 'held',
        reason: 'needs_review',
        userSafeMessage: 'Los cambios se guardaron localmente, pero requieren revisión manual.',
      })
    );
    const { confirm, setProposal, setError } = renderActions();

    await expect(confirm()).resolves.toBe(false);
    expect(setError).toHaveBeenLastCalledWith(
      'Los cambios se guardaron localmente, pero requieren revisión manual.'
    );
    expect(setProposal).not.toHaveBeenCalled();
    expect(mocks.reportOutcome).toHaveBeenLastCalledWith('pending');
  });

  it('a blocked write shows the producer error', async () => {
    mocks.patch.mockResolvedValue(
      write({
        date: DATE,
        savedHere: false,
        state: 'not_saved',
        reason: 'blocked',
        userSafeMessage: 'Texto del aviso',
        blockingError: new Error('Se bloqueó una reducción sospechosa de texto clínico.'),
      })
    );
    const { confirm, setError } = renderActions();

    await expect(confirm()).resolves.toBe(false);
    expect(setError).toHaveBeenLastCalledWith(
      'Se bloqueó una reducción sospechosa de texto clínico.'
    );
  });

  it('a write waiting in the queue closes the proposal', async () => {
    mocks.patch.mockResolvedValue(
      write({
        date: DATE,
        savedHere: true,
        state: 'local',
        cause: 'retrying',
      })
    );
    const { confirm, setProposal } = renderActions();

    await expect(confirm()).resolves.toBe(true);
    expect(setProposal).toHaveBeenCalledWith(null);
    expect(mocks.reportOutcome).toHaveBeenLastCalledWith('resolved');
  });
});
