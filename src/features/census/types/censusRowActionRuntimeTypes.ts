import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { RowActionConfirmDescriptor } from '@/features/census/types/censusRowActionCommandTypes';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export interface RowActionRuntimeActions {
  clearPatient: (
    bedId: string,
    confirmedLastUpdated?: string,
    confirmedOccupant?: ConfirmedBedOccupantIdentity
  ) => Promise<boolean>;
  addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
  setMovement: (nextActionState: ActionState) => void;
  openDischarge: (dischargePatch: Partial<DischargeState>) => void;
  openTransfer: (transferPatch: Partial<TransferState>) => void;
}

export interface RowActionRuntimeConfirm {
  confirm: (descriptor: RowActionConfirmDescriptor) => Promise<boolean>;
}
