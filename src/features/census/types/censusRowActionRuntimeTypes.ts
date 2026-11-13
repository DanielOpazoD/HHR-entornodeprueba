import type { CMAData } from '@/types/domain/movements';
import type { ActionState, DischargeState, TransferState } from '@/domain/censusActionContracts';
import type { RowActionConfirmDescriptor } from '@/features/census/types/censusRowActionCommandTypes';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export interface RowActionRuntimeActions {
  clearPatient: (
    bedId: string,
    confirmedLastUpdated?: string,
    confirmedOccupant?: ConfirmedBedOccupantIdentity,
    confirmedAssociatedCrib?: ConfirmedBedOccupantIdentity | null
  ) => Promise<boolean>;
  addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
  /** Records the «paciente no válido» mark; resolves only once the server holds it. */
  markInvalidEpisode: (mark: { clinicalEpisodeId: string; bedId: string }) => Promise<void>;
  /** Removes the same episode from the editable previous day; returns what is left to review. */
  cleanInvalidEpisodePreviousDay: (clinicalEpisodeId: string) => Promise<string | null>;
  setMovement: (nextActionState: ActionState) => void;
  openDischarge: (dischargePatch: Partial<DischargeState>) => void;
  openTransfer: (transferPatch: Partial<TransferState>) => void;
}

export interface RowActionRuntimeConfirm {
  confirm: (descriptor: RowActionConfirmDescriptor) => Promise<boolean>;
}
