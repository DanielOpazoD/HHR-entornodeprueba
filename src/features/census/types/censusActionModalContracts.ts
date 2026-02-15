import type { DischargeStatus, EvacuationMethod, ReceivingCenter } from '@/constants';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';

export type TransferUpdateField =
  | 'evacuationMethod'
  | 'evacuationMethodOther'
  | 'receivingCenter'
  | 'receivingCenterOther'
  | 'transferEscort';

export interface MoveCopyModalProps {
  isOpen: boolean;
  type: 'move' | 'copy' | null;
  sourceBedId: string | null;
  targetBedId: string | null;
  onClose: () => void;
  onSetTarget: (id: string) => void;
  onConfirm: (targetDate?: string) => void;
}

export interface DischargeModalProps {
  isOpen: boolean;
  isEditing: boolean;
  status: DischargeStatus;
  recordDate?: string;
  hasClinicalCrib?: boolean;
  clinicalCribName?: string;
  clinicalCribStatus?: DischargeStatus;
  onClinicalCribStatusChange?: (s: DischargeStatus) => void;
  dischargeTarget?: DischargeTarget;
  onDischargeTargetChange?: (target: DischargeTarget) => void;
  initialType?: string;
  initialOtherDetails?: string;
  initialTime?: string;
  initialMovementDate?: string;
  onStatusChange: (s: DischargeStatus) => void;
  onClose: () => void;
  onConfirm: (data: {
    status: DischargeStatus;
    type?: string;
    typeOther?: string;
    time: string;
    movementDate?: string;
    dischargeTarget?: DischargeTarget;
  }) => void;
}

export interface TransferModalProps {
  isOpen: boolean;
  isEditing: boolean;
  recordDate?: string;
  evacuationMethod: EvacuationMethod;
  evacuationMethodOther: string;
  receivingCenter: ReceivingCenter;
  receivingCenterOther: string;
  transferEscort: string;
  initialTime?: string;
  initialMovementDate?: string;
  hasClinicalCrib?: boolean;
  clinicalCribName?: string;
  onUpdate: (field: TransferUpdateField, value: string) => void;
  onClose: () => void;
  onConfirm: (data: { time: string; movementDate?: string }) => void;
}
