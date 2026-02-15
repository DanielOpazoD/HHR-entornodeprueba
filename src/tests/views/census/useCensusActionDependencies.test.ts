import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCensusActionDependencies } from '@/features/census/hooks/useCensusActionDependencies';

const mockedUseDailyRecordData = vi.fn();
const mockedUseDailyRecordActions = vi.fn();
const mockedUseConfirmDialog = vi.fn();
const mockedUseNotification = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mockedUseDailyRecordData(),
  useDailyRecordActions: () => mockedUseDailyRecordActions(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => mockedUseConfirmDialog(),
  useNotification: () => mockedUseNotification(),
}));

describe('useCensusActionDependencies', () => {
  it('returns required action/runtime dependencies from app contexts', () => {
    const clearPatient = vi.fn();
    const moveOrCopyPatient = vi.fn();
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const addCMA = vi.fn();
    const copyPatientToDate = vi.fn();
    const confirm = vi.fn();
    const notifyError = vi.fn();

    mockedUseDailyRecordData.mockReturnValue({
      record: null,
      stabilityRules: { canPerformActions: true },
    });
    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient,
      moveOrCopyPatient,
      addDischarge,
      updateDischarge,
      addTransfer,
      updateTransfer,
      addCMA,
      copyPatientToDate,
    });
    mockedUseConfirmDialog.mockReturnValue({ confirm });
    mockedUseNotification.mockReturnValue({
      error: notifyError,
    });

    const { result } = renderHook(() => useCensusActionDependencies());

    expect(result.current.clearPatient).toBe(clearPatient);
    expect(result.current.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(result.current.addDischarge).toBe(addDischarge);
    expect(result.current.updateDischarge).toBe(updateDischarge);
    expect(result.current.addTransfer).toBe(addTransfer);
    expect(result.current.updateTransfer).toBe(updateTransfer);
    expect(result.current.addCMA).toBe(addCMA);
    expect(result.current.copyPatientToDate).toBe(copyPatientToDate);
    expect(result.current.confirm).toBe(confirm);
    expect(result.current.notifyError).toBe(notifyError);
  });
});
