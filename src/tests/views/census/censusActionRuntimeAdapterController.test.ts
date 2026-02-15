import { describe, expect, it, vi } from 'vitest';
import {
  buildDischargeRuntimeActions,
  buildMoveOrCopyRuntimeActions,
  buildTransferRuntimeActions,
} from '@/features/census/controllers/censusActionRuntimeAdapterController';

describe('censusActionRuntimeAdapterController', () => {
  it('builds move/copy runtime actions preserving function references', () => {
    const moveOrCopyPatient = vi.fn();
    const copyPatientToDate = vi.fn();

    const actions = buildMoveOrCopyRuntimeActions(moveOrCopyPatient, copyPatientToDate);

    expect(actions.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(actions.copyPatientToDate).toBe(copyPatientToDate);
  });

  it('builds discharge runtime actions preserving function references', () => {
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();

    const actions = buildDischargeRuntimeActions(addDischarge, updateDischarge);

    expect(actions.addDischarge).toBe(addDischarge);
    expect(actions.updateDischarge).toBe(updateDischarge);
  });

  it('builds transfer runtime actions preserving function references', () => {
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();

    const actions = buildTransferRuntimeActions(addTransfer, updateTransfer);

    expect(actions.addTransfer).toBe(addTransfer);
    expect(actions.updateTransfer).toBe(updateTransfer);
  });
});
