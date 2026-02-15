import { describe, expect, it } from 'vitest';
import {
  buildDischargeModalBinding,
  buildMoveCopyModalBinding,
  buildTransferModalBinding,
} from '@/features/census/controllers/censusModalBindingsController';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
} from '@/features/census/types/censusActionTypes';

describe('censusModalBindingsController', () => {
  it('builds safe move/copy defaults from empty action state', () => {
    expect(buildMoveCopyModalBinding(createInitialActionState())).toEqual({
      isOpen: false,
      type: 'move',
      sourceBedId: '',
      targetBedId: '',
    });
  });

  it('maps discharge modal binding flags and defaults', () => {
    const state = {
      ...createInitialDischargeState(),
      isOpen: true,
      recordId: 'dis-1',
      hasClinicalCrib: true,
      clinicalCribName: 'RN A',
      time: '08:30',
    };

    expect(buildDischargeModalBinding(state)).toEqual({
      isOpen: true,
      isEditing: true,
      status: state.status,
      hasClinicalCrib: true,
      clinicalCribName: 'RN A',
      clinicalCribStatus: undefined,
      dischargeTarget: undefined,
      initialType: undefined,
      initialOtherDetails: undefined,
      initialTime: '08:30',
      initialMovementDate: undefined,
    });
  });

  it('maps transfer binding while normalizing optional strings', () => {
    const state = {
      ...createInitialTransferState(),
      isOpen: true,
      recordId: 'tr-1',
      evacuationMethodOther: '',
      receivingCenterOther: '',
      hasClinicalCrib: false,
    };

    expect(buildTransferModalBinding(state)).toEqual({
      isOpen: true,
      isEditing: true,
      evacuationMethod: state.evacuationMethod,
      evacuationMethodOther: '',
      receivingCenter: state.receivingCenter,
      receivingCenterOther: '',
      transferEscort: state.transferEscort,
      hasClinicalCrib: false,
      clinicalCribName: undefined,
      initialTime: undefined,
      initialMovementDate: undefined,
    });
  });
});
