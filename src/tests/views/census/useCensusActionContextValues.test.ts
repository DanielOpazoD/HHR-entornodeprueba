import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';
import { useCensusActionContextValues } from '@/features/census/hooks/useCensusActionContextValues';

describe('useCensusActionContextValues', () => {
  it('keeps commandsValue stable when only state changes', () => {
    const noop = vi.fn();
    const noopSetActionState = vi.fn();
    const noopSetDischargeState = vi.fn();
    const noopSetTransferState = vi.fn();

    const { result, rerender } = renderHook(
      ({ actionState }) =>
        useCensusActionContextValues({
          actionState,
          setActionState: noopSetActionState,
          dischargeState: createInitialDischargeState(),
          setDischargeState: noopSetDischargeState,
          transferState: createInitialTransferState(),
          setTransferState: noopSetTransferState,
          executeMoveOrCopy: noop,
          executeDischarge: noop,
          handleEditDischarge: noop,
          executeTransfer: noop,
          handleEditTransfer: noop,
          handleRowAction: noop,
        }),
      { initialProps: { actionState: createInitialActionState() } }
    );

    const initialCommands = result.current.commandsValue;

    rerender({
      actionState: {
        type: 'move',
        sourceBedId: 'R1',
        targetBedId: 'R2',
      },
    });

    expect(result.current.commandsValue).toBe(initialCommands);
    expect(result.current.stateValue.actionState).toEqual({
      type: 'move',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
  });
});
