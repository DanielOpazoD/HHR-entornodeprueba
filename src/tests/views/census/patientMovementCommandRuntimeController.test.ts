import { describe, expect, it, vi } from 'vitest';
import {
  executeDischargeRuntimeCommand,
  executeTransferRuntimeCommand,
} from '@/features/census/controllers/patientMovementCommandRuntimeController';

describe('patientMovementCommandRuntimeController', () => {
  it('routes update discharge command to updateDischarge action', () => {
    const actions = {
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
    };

    executeDischargeRuntimeCommand(
      {
        kind: 'updateDischarge',
        id: 'd-1',
        payload: {
          status: 'Fallecido',
          type: undefined,
          typeOther: undefined,
          time: '12:00',
        },
      },
      actions
    );

    expect(actions.addDischarge).not.toHaveBeenCalled();
    expect(actions.updateDischarge).toHaveBeenCalledWith(
      'd-1',
      'Fallecido',
      undefined,
      undefined,
      '12:00',
      undefined
    );
  });

  it('routes add discharge command to addDischarge action', () => {
    const actions = {
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
    };

    executeDischargeRuntimeCommand(
      {
        kind: 'addDischarge',
        bedId: 'R1',
        payload: {
          status: 'Vivo',
          cribStatus: 'Vivo',
          type: 'Domicilio (Habitual)',
          typeOther: '',
          time: '09:30',
          dischargeTarget: 'both',
        },
      },
      actions
    );

    expect(actions.updateDischarge).not.toHaveBeenCalled();
    expect(actions.addDischarge).toHaveBeenCalledWith(
      'R1',
      'Vivo',
      'Vivo',
      'Domicilio (Habitual)',
      '',
      '09:30',
      'both'
    );
  });

  it('routes update transfer command to updateTransfer action', () => {
    const actions = {
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
    };

    executeTransferRuntimeCommand(
      {
        kind: 'updateTransfer',
        id: 't-1',
        payload: {
          evacuationMethod: 'Avión comercial',
          receivingCenter: 'Hospital Salvador',
          receivingCenterOther: '',
          transferEscort: 'TENS',
          time: '14:10',
        },
      },
      actions
    );

    expect(actions.addTransfer).not.toHaveBeenCalled();
    expect(actions.updateTransfer).toHaveBeenCalledWith('t-1', {
      evacuationMethod: 'Avión comercial',
      receivingCenter: 'Hospital Salvador',
      receivingCenterOther: '',
      transferEscort: 'TENS',
      time: '14:10',
      movementDate: undefined,
    });
  });

  it('routes add transfer command to addTransfer action', () => {
    const actions = {
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
    };

    executeTransferRuntimeCommand(
      {
        kind: 'addTransfer',
        bedId: 'R2',
        payload: {
          evacuationMethod: 'Avión comercial',
          receivingCenter: 'Hospital Salvador',
          receivingCenterOther: '',
          transferEscort: 'Médico',
          time: '16:20',
        },
      },
      actions
    );

    expect(actions.updateTransfer).not.toHaveBeenCalled();
    expect(actions.addTransfer).toHaveBeenCalledWith(
      'R2',
      'Avión comercial',
      'Hospital Salvador',
      '',
      'Médico',
      '16:20'
    );
  });
});
