import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';

export interface MoveCopyModalBinding {
  isOpen: boolean;
  type: 'move' | 'copy';
  sourceBedId: string;
  targetBedId: string;
}

export interface DischargeModalBinding {
  isOpen: boolean;
  isEditing: boolean;
  status: DischargeState['status'];
  hasClinicalCrib: boolean;
  clinicalCribName?: string;
  clinicalCribStatus?: DischargeState['clinicalCribStatus'];
  dischargeTarget?: DischargeState['dischargeTarget'];
  initialType?: string;
  initialOtherDetails?: string;
  initialTime?: string;
  initialMovementDate?: string;
}

export interface TransferModalBinding {
  isOpen: boolean;
  isEditing: boolean;
  evacuationMethod: TransferState['evacuationMethod'];
  evacuationMethodOther: string;
  receivingCenter: TransferState['receivingCenter'];
  receivingCenterOther: string;
  transferEscort: TransferState['transferEscort'];
  hasClinicalCrib: boolean;
  clinicalCribName?: string;
  initialTime?: string;
  initialMovementDate?: string;
}

export const buildMoveCopyModalBinding = (actionState: ActionState): MoveCopyModalBinding => ({
  isOpen: actionState.type !== null,
  type: actionState.type || 'move',
  sourceBedId: actionState.sourceBedId || '',
  targetBedId: actionState.targetBedId || '',
});

export const buildDischargeModalBinding = (
  dischargeState: DischargeState
): DischargeModalBinding => ({
  isOpen: dischargeState.isOpen,
  isEditing: !!dischargeState.recordId,
  status: dischargeState.status,
  hasClinicalCrib: !!dischargeState.hasClinicalCrib,
  clinicalCribName: dischargeState.clinicalCribName,
  clinicalCribStatus: dischargeState.clinicalCribStatus,
  dischargeTarget: dischargeState.dischargeTarget,
  initialType: dischargeState.type,
  initialOtherDetails: dischargeState.typeOther,
  initialTime: dischargeState.time,
  initialMovementDate: dischargeState.movementDate,
});

export const buildTransferModalBinding = (transferState: TransferState): TransferModalBinding => ({
  isOpen: transferState.isOpen,
  isEditing: !!transferState.recordId,
  evacuationMethod: transferState.evacuationMethod,
  evacuationMethodOther: transferState.evacuationMethodOther || '',
  receivingCenter: transferState.receivingCenter,
  receivingCenterOther: transferState.receivingCenterOther,
  transferEscort: transferState.transferEscort,
  hasClinicalCrib: !!transferState.hasClinicalCrib,
  clinicalCribName: transferState.clinicalCribName,
  initialTime: transferState.time,
  initialMovementDate: transferState.movementDate,
});
