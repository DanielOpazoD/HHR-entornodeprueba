// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildCensusActionDependenciesModelParams } from '@/features/census/controllers/censusActionDependenciesModelController';

describe('censusActionDependenciesModelController', () => {
  it('maps context values into dependency builder params', () => {
    const clearPatient = vi.fn();
    const moveOrCopyPatient = vi.fn();
    const copyPatientToDate = vi.fn();
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const addCMA = vi.fn();
    const confirm = vi.fn();
    const error = vi.fn();

    const result = buildCensusActionDependenciesModelParams({
      dailyRecordData: {
        record: null,
        stabilityRules: {
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
          canEditField: () => true,
          canPerformActions: true,
        },
      },
      bedActions: {
        clearPatient,
        moveOrCopyPatient,
        copyPatientToDate,
      },
      movementActions: {
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCMA,
      },
      confirmDialog: {
        confirm,
      },
      notification: {
        error,
      },
    });

    expect(result.runtime.clearPatient).toBe(clearPatient);
    expect(result.runtime.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(result.runtime.copyPatientToDate).toBe(copyPatientToDate);
    expect(result.runtime.addDischarge).toBe(addDischarge);
    expect(result.runtime.updateDischarge).toBe(updateDischarge);
    expect(result.runtime.addTransfer).toBe(addTransfer);
    expect(result.runtime.updateTransfer).toBe(updateTransfer);
    expect(result.runtime.addCMA).toBe(addCMA);
    expect(result.ui.confirm).toBe(confirm);
    expect(result.ui.notifyError).toBe(error);
  });
});
