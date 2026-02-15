import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CensusModalBindingsModel } from '@/features/census/hooks/useCensusModalBindings';
import { useCensusActionModalProps } from '@/features/census/hooks/useCensusActionModalProps';
import { createInitialTransferState } from '@/features/census/types/censusActionTypes';

describe('useCensusActionModalProps', () => {
  it('maps bindings + handlers + commands into modal props', () => {
    const modalBindings: CensusModalBindingsModel = {
      moveCopy: {
        isOpen: true,
        type: 'move',
        sourceBedId: 'R1',
        targetBedId: 'R2',
      },
      discharge: {
        isOpen: true,
        isEditing: false,
        status: 'Vivo',
        hasClinicalCrib: false,
      },
      transfer: {
        isOpen: true,
        isEditing: false,
        evacuationMethod: createInitialTransferState().evacuationMethod,
        evacuationMethodOther: '',
        receivingCenter: createInitialTransferState().receivingCenter,
        receivingCenterOther: '',
        transferEscort: createInitialTransferState().transferEscort,
        hasClinicalCrib: false,
      },
    };
    const modalHandlers = {
      closeMoveCopy: vi.fn(),
      setMoveCopyTarget: vi.fn(),
      updateDischargeStatus: vi.fn(),
      updateDischargeClinicalCribStatus: vi.fn(),
      updateDischargeTarget: vi.fn(),
      closeDischarge: vi.fn(),
      updateTransfer: vi.fn(),
      closeTransfer: vi.fn(),
    };
    const actionCommands = {
      executeMoveOrCopy: vi.fn(),
      executeDischarge: vi.fn(),
      executeTransfer: vi.fn(),
    };

    const { result } = renderHook(() =>
      useCensusActionModalProps({
        modalBindings,
        modalHandlers,
        recordDate: '2024-12-11',
        actionCommands,
      })
    );

    expect(result.current.moveCopyProps).toMatchObject({
      isOpen: true,
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
    expect(result.current.moveCopyProps.onConfirm).toBe(actionCommands.executeMoveOrCopy);
    expect(result.current.dischargeProps.onConfirm).toBe(actionCommands.executeDischarge);
    expect(result.current.transferProps.onConfirm).toBe(actionCommands.executeTransfer);
    expect(result.current.transferProps.onUpdate).toBe(modalHandlers.updateTransfer);
  });
});
