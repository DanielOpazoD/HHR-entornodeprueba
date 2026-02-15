import type { CMAData } from '@/types';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

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
      kind: 'confirmCma';
      bedId: string;
      cmaData: Omit<CMAData, 'id' | 'timestamp'>;
      confirm: RowActionConfirmDescriptor;
    };
