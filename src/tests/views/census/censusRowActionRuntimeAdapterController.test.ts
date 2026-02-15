import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISCHARGE_STATUS,
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
} from '@/constants';
import type { DischargeState, TransferState } from '@/features/census/types/censusActionTypes';
import { buildRowActionRuntimeActions } from '@/features/census/controllers/censusRowActionRuntimeAdapterController';

describe('censusRowActionRuntimeAdapterController', () => {
  it('maps clear/cma/movement actions directly', () => {
    const clearPatient = vi.fn();
    const addCMA = vi.fn();
    const setActionState = vi.fn();
    const setDischargeState = vi.fn();
    const setTransferState = vi.fn();
    const actions = buildRowActionRuntimeActions({
      clearPatient,
      addCMA,
      setActionState,
      setDischargeState,
      setTransferState,
    });

    actions.clearPatient('R1');
    actions.addCMA({
      bedName: 'R1',
      patientName: 'Paciente',
      rut: '1-9',
      age: '30',
      diagnosis: 'Dx',
      specialty: 'Cirugía',
      interventionType: 'Cirugía Mayor Ambulatoria',
    });
    actions.setMovement({ type: 'move', sourceBedId: 'R1', targetBedId: 'R2' });

    expect(clearPatient).toHaveBeenCalledWith('R1');
    expect(addCMA).toHaveBeenCalledTimes(1);
    expect(setActionState).toHaveBeenCalledWith({
      type: 'move',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
  });

  it('applies discharge and transfer patches through state updaters', () => {
    const setActionState = vi.fn();
    const setDischargeState = vi.fn();
    const setTransferState = vi.fn();
    const actions = buildRowActionRuntimeActions({
      clearPatient: vi.fn(),
      addCMA: vi.fn(),
      setActionState,
      setDischargeState,
      setTransferState,
    });

    actions.openDischarge({ bedId: 'R1', isOpen: true });
    actions.openTransfer({ bedId: 'R2', isOpen: true, transferEscort: 'Matrona' });

    const dischargeUpdater = setDischargeState.mock.calls[0][0] as (
      previous: DischargeState
    ) => DischargeState;
    const transferUpdater = setTransferState.mock.calls[0][0] as (
      previous: TransferState
    ) => TransferState;
    const previousDischarge: DischargeState = {
      bedId: null,
      isOpen: false,
      status: DEFAULT_DISCHARGE_STATUS,
    };
    const previousTransfer: TransferState = {
      bedId: null,
      isOpen: false,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
    };

    expect(dischargeUpdater(previousDischarge)).toEqual({
      bedId: 'R1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
    });
    expect(transferUpdater(previousTransfer)).toEqual({
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: 'Matrona',
    });
    expect(setActionState).not.toHaveBeenCalled();
  });
});
