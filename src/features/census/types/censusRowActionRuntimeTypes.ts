import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { RowActionConfirmDescriptor } from '@/features/census/types/censusRowActionCommandTypes';

export interface RowActionRuntimeActions {
  clearPatient: (bedId: string, confirmedLastUpdated?: string) => Promise<boolean>;
  addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
  setMovement: (nextActionState: ActionState) => void;
  openDischarge: (dischargePatch: Partial<DischargeState>) => void;
  openTransfer: (transferPatch: Partial<TransferState>) => void;
}

export interface RowActionRuntimeConfirm {
  confirm: (descriptor: RowActionConfirmDescriptor) => Promise<boolean>;
}
