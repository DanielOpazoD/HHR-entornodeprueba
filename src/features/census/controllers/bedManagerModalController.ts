import { BedBlockSchema } from '@/schemas/inputSchemas';
import {
  failWithCode,
  ok,
  type ControllerResult,
} from '@/features/census/controllers/controllerResult';

export interface BedManagerModalState {
  blockingBedId: string | null;
  editingBedId: string | null;
  reason: string;
  error: string | null;
}

export interface BedManagerBedClickInput {
  bedId: string;
  isBlocked: boolean;
  blockedReason?: string | null;
}

export type BedManagerReasonValidationErrorCode = 'INVALID_REASON';

export const INITIAL_BED_MANAGER_MODAL_STATE: BedManagerModalState = {
  blockingBedId: null,
  editingBedId: null,
  reason: '',
  error: null,
};

export const hasBedManagerDialogOpen = (state: BedManagerModalState): boolean =>
  state.blockingBedId !== null || state.editingBedId !== null;

export const resolveBedManagerBedClick = (
  previousState: BedManagerModalState,
  input: BedManagerBedClickInput
): BedManagerModalState => {
  if (input.isBlocked) {
    return {
      ...previousState,
      blockingBedId: null,
      editingBedId: input.bedId,
      reason: input.blockedReason || '',
      error: null,
    };
  }

  return {
    ...previousState,
    blockingBedId: input.bedId,
    editingBedId: null,
    reason: '',
    error: null,
  };
};

export const patchBedManagerReason = (
  previousState: BedManagerModalState,
  reason: string
): BedManagerModalState => ({
  ...previousState,
  reason,
  error: null,
});

export const patchBedManagerError = (
  previousState: BedManagerModalState,
  error: string | null
): BedManagerModalState => ({
  ...previousState,
  error,
});

export const closeBedManagerBlockingDialog = (
  previousState: BedManagerModalState
): BedManagerModalState => ({
  ...previousState,
  blockingBedId: null,
  reason: '',
  error: null,
});

export const closeBedManagerEditingDialog = (
  previousState: BedManagerModalState
): BedManagerModalState => ({
  ...previousState,
  editingBedId: null,
  reason: '',
  error: null,
});

export const validateBedManagerReason = (
  reason: string
): ControllerResult<string, BedManagerReasonValidationErrorCode> => {
  const parsed = BedBlockSchema.safeParse({ reason });
  if (!parsed.success) {
    return failWithCode('INVALID_REASON', parsed.error.issues[0]?.message || 'Motivo inválido');
  }

  return ok(reason);
};
