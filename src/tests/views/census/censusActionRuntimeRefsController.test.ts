import { describe, expect, it, vi } from 'vitest';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';
import { buildCensusActionRuntimeRefsParams } from '@/features/census/controllers/censusActionRuntimeRefsController';

describe('censusActionRuntimeRefsController', () => {
  it('maps provider state + dependencies to runtime refs hook params', () => {
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

    const params = buildCensusActionRuntimeRefsParams({
      state: {
        actionState: createInitialActionState(),
        dischargeState: createInitialDischargeState(),
        transferState: createInitialTransferState(),
      },
      dependencies: {
        record: null,
        stabilityRules: {
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
          canEditField: () => true,
          canPerformActions: true,
        },
        clearPatient,
        moveOrCopyPatient,
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCMA,
        copyPatientToDate,
        confirm,
        notifyError,
      },
    });

    expect(params.actionState).toEqual(createInitialActionState());
    expect(params.dischargeState).toEqual(createInitialDischargeState());
    expect(params.transferState).toEqual(createInitialTransferState());
    expect(params.clearPatient).toBe(clearPatient);
    expect(params.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(params.addDischarge).toBe(addDischarge);
    expect(params.updateDischarge).toBe(updateDischarge);
    expect(params.addTransfer).toBe(addTransfer);
    expect(params.updateTransfer).toBe(updateTransfer);
    expect(params.addCma).toBe(addCMA);
    expect(params.copyPatientToDate).toBe(copyPatientToDate);
    expect(params.confirm).toBe(confirm);
    expect(params.notifyError).toBe(notifyError);
  });
});
