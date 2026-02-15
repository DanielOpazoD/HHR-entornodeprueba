import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';
import { useCensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';

const stabilityRules: StabilityRules = {
  isDateLocked: false,
  isDayShiftLocked: false,
  isNightShiftLocked: false,
  canEditField: () => true,
  canPerformActions: true,
};

describe('useCensusActionRuntimeRefs', () => {
  it('keeps refs updated with latest values across rerenders', () => {
    const clearPatient = vi.fn();
    const moveOrCopyPatient = vi.fn();
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const addCma = vi.fn();
    const copyPatientToDate = vi.fn();
    const confirm = vi.fn();
    const notifyError = vi.fn();

    const { result, rerender } = renderHook(props => useCensusActionRuntimeRefs(props), {
      initialProps: {
        actionState: createInitialActionState(),
        dischargeState: createInitialDischargeState(),
        transferState: createInitialTransferState(),
        record: null,
        stabilityRules,
        clearPatient,
        moveOrCopyPatient,
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCma,
        copyPatientToDate,
        confirm,
        notifyError,
      },
    });

    const nextClearPatient = vi.fn();
    const nextNotifyError = vi.fn();

    rerender({
      actionState: { type: 'copy', sourceBedId: 'R1', targetBedId: 'R2' },
      dischargeState: { bedId: 'R1', isOpen: true, status: 'Vivo' },
      transferState: {
        bedId: 'R2',
        isOpen: true,
        evacuationMethod: 'Avión comercial',
        evacuationMethodOther: '',
        receivingCenter: 'Hospital Salvador',
        receivingCenterOther: '',
        transferEscort: 'TENS',
      },
      record: null,
      stabilityRules,
      clearPatient: nextClearPatient,
      moveOrCopyPatient,
      addDischarge,
      updateDischarge,
      addTransfer,
      updateTransfer,
      addCma,
      copyPatientToDate,
      confirm,
      notifyError: nextNotifyError,
    });

    expect(result.current.actionStateRef.current).toEqual({
      type: 'copy',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
    expect(result.current.dischargeStateRef.current).toEqual({
      bedId: 'R1',
      isOpen: true,
      status: 'Vivo',
    });
    expect(result.current.transferStateRef.current).toEqual({
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: 'Avión comercial',
      evacuationMethodOther: '',
      receivingCenter: 'Hospital Salvador',
      receivingCenterOther: '',
      transferEscort: 'TENS',
    });
    expect(result.current.clearPatientRef.current).toBe(nextClearPatient);
    expect(result.current.notifyErrorRef.current).toBe(nextNotifyError);
  });
});
