import type { DischargeMovementActions, TransferMovementActions } from './actions';

export interface MoveOrCopyRuntimeActions {
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
  copyPatientToDate: (bedId: string, targetDate: string, targetBedId?: string) => Promise<void>;
}

export type DischargeRuntimeActions = Pick<
  DischargeMovementActions,
  'addDischarge' | 'updateDischarge'
>;

export type TransferRuntimeActions = Pick<
  TransferMovementActions,
  'addTransfer' | 'updateTransfer'
>;
