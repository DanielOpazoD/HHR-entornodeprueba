// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildCensusActionCommandsControllerParams,
  buildCensusActionContextValuesParams,
} from '@/features/census/controllers/censusActionsProviderModelController';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';

describe('censusActionsProviderModelController', () => {
  it('builds command controller params from runtime refs and setter state', () => {
    const runtimeRefs = {
      actionStateRef: { current: createInitialActionState() },
      dischargeStateRef: { current: createInitialDischargeState() },
      transferStateRef: { current: createInitialTransferState() },
      recordRef: { current: null },
      stabilityRulesRef: {
        current: {
          canPerformActions: true,
          canEditField: () => true,
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
        },
      },
      clearPatientRef: { current: vi.fn() },
      moveOrCopyPatientRef: { current: vi.fn() },
      addDischargeRef: { current: vi.fn() },
      updateDischargeRef: { current: vi.fn() },
      addTransferRef: { current: vi.fn() },
      updateTransferRef: { current: vi.fn() },
      addCmaRef: { current: vi.fn() },
      copyPatientToDateRef: { current: vi.fn() },
      confirmRef: { current: vi.fn() },
      notifyErrorRef: { current: vi.fn() },
    } as const;
    const stateStore = {
      setActionState: vi.fn(),
      setDischargeState: vi.fn(),
      setTransferState: vi.fn(),
    };

    const params = buildCensusActionCommandsControllerParams({
      runtimeRefs,
      stateStore,
      getCurrentTime: () => '08:00',
    });

    expect(params.actionStateRef).toBe(runtimeRefs.actionStateRef);
    expect(params.setActionState).toBe(stateStore.setActionState);
    expect(params.getCurrentTime()).toBe('08:00');
  });

  it('builds action context params from state store and resolved command handlers', () => {
    const stateStore = {
      actionState: createInitialActionState(),
      setActionState: vi.fn(),
      dischargeState: createInitialDischargeState(),
      setDischargeState: vi.fn(),
      transferState: createInitialTransferState(),
      setTransferState: vi.fn(),
      handleEditDischarge: vi.fn(),
      handleEditTransfer: vi.fn(),
    };
    const commands = {
      executeMoveOrCopy: vi.fn(),
      executeDischarge: vi.fn(),
      executeTransfer: vi.fn(),
      handleRowAction: vi.fn(),
    };

    const params = buildCensusActionContextValuesParams({
      stateStore: stateStore as never,
      commands,
    });

    expect(params.actionState).toEqual(createInitialActionState());
    expect(params.executeTransfer).toBe(commands.executeTransfer);
    expect(params.handleEditDischarge).toBe(stateStore.handleEditDischarge);
    expect(params.handleRowAction).toBe(commands.handleRowAction);
  });
});
