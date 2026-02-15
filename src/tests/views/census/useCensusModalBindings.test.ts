import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';
import { useCensusModalBindings } from '@/features/census/hooks/useCensusModalBindings';

describe('useCensusModalBindings', () => {
  it('builds move/discharge/transfer modal bindings from state', () => {
    const { result } = renderHook(() =>
      useCensusModalBindings({
        actionState: {
          type: 'copy',
          sourceBedId: 'R1',
          targetBedId: 'R2',
        },
        dischargeState: {
          ...createInitialDischargeState(),
          isOpen: true,
          status: 'Vivo',
        },
        transferState: {
          ...createInitialTransferState(),
          isOpen: true,
        },
      })
    );

    expect(result.current.moveCopy).toEqual({
      isOpen: true,
      type: 'copy',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
    expect(result.current.discharge.isOpen).toBe(true);
    expect(result.current.transfer.isOpen).toBe(true);
  });

  it('keeps reference stable when input references do not change', () => {
    const actionState = createInitialActionState();
    const dischargeState = createInitialDischargeState();
    const transferState = createInitialTransferState();

    const { result, rerender } = renderHook(() =>
      useCensusModalBindings({
        actionState,
        dischargeState,
        transferState,
      })
    );

    const firstValue = result.current;
    rerender();
    expect(result.current).toBe(firstValue);
  });
});
