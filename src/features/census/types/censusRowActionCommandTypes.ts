import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';

export type RowActionConfirmDescriptor = ControllerConfirmDescriptor;

export type RowActionCommand =
  | {
      kind: 'confirmClear';
      bedId: string;
      confirm: RowActionConfirmDescriptor;
    }
  | {
      kind: 'setMovement';
      nextActionState: ActionState;
    }
  | {
      kind: 'openDischarge';
      dischargePatch: Partial<DischargeState>;
    }
  | {
      kind: 'openTransfer';
      transferPatch: Partial<TransferState>;
    }
  | {
      kind: 'confirmInvalid';
      bedId: string;
      clinicalEpisodeId: string;
      confirm: RowActionConfirmDescriptor;
    }
  | {
      kind: 'confirmCma';
      bedId: string;
      cmaData: Omit<CMAData, 'id' | 'timestamp'>;
      confirm: RowActionConfirmDescriptor;
    };
