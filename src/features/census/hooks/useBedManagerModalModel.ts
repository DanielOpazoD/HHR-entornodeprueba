import { useCallback, useMemo, useState } from 'react';
import {
  closeBedManagerBlockingDialog,
  closeBedManagerEditingDialog,
  hasBedManagerDialogOpen,
  INITIAL_BED_MANAGER_MODAL_STATE,
  patchBedManagerError,
  patchBedManagerReason,
  resolveBedManagerBedClick,
  type BedManagerBedClickInput,
  type BedManagerModalState,
  validateBedManagerReason,
} from '@/features/census/controllers/bedManagerModalController';

interface UseBedManagerModalModelParams {
  toggleBlockBed: (bedId: string, reason?: string) => void;
  updateBlockedReason: (bedId: string, reason: string) => void;
}

interface UseBedManagerModalModelResult extends BedManagerModalState {
  isBlockingDialogOpen: boolean;
  isEditingDialogOpen: boolean;
  isAnyDialogOpen: boolean;
  handleBedClick: (input: BedManagerBedClickInput) => void;
  handleReasonChange: (value: string) => void;
  confirmBlock: () => void;
  cancelBlock: () => void;
  closeEditDialog: () => void;
  saveReason: () => void;
  unblockBed: () => void;
}

export const useBedManagerModalModel = ({
  toggleBlockBed,
  updateBlockedReason,
}: UseBedManagerModalModelParams): UseBedManagerModalModelResult => {
  const [state, setState] = useState<BedManagerModalState>(INITIAL_BED_MANAGER_MODAL_STATE);

  const handleBedClick = useCallback((input: BedManagerBedClickInput) => {
    setState(previousState => resolveBedManagerBedClick(previousState, input));
  }, []);

  const handleReasonChange = useCallback((value: string) => {
    setState(previousState => patchBedManagerReason(previousState, value));
  }, []);

  const confirmBlock = useCallback(() => {
    if (!state.blockingBedId) {
      return;
    }

    const validation = validateBedManagerReason(state.reason);
    if (!validation.ok) {
      setState(previousState => patchBedManagerError(previousState, validation.error.message));
      return;
    }

    toggleBlockBed(state.blockingBedId, validation.value);
    setState(previousState => closeBedManagerBlockingDialog(previousState));
  }, [state.blockingBedId, state.reason, toggleBlockBed]);

  const cancelBlock = useCallback(() => {
    setState(previousState => closeBedManagerBlockingDialog(previousState));
  }, []);

  const closeEditDialog = useCallback(() => {
    setState(previousState => closeBedManagerEditingDialog(previousState));
  }, []);

  const saveReason = useCallback(() => {
    if (!state.editingBedId) {
      return;
    }

    const validation = validateBedManagerReason(state.reason);
    if (!validation.ok) {
      setState(previousState => patchBedManagerError(previousState, validation.error.message));
      return;
    }

    updateBlockedReason(state.editingBedId, validation.value);
    setState(previousState => closeBedManagerEditingDialog(previousState));
  }, [state.editingBedId, state.reason, updateBlockedReason]);

  const unblockBed = useCallback(() => {
    if (!state.editingBedId) {
      return;
    }

    toggleBlockBed(state.editingBedId);
    setState(previousState => closeBedManagerEditingDialog(previousState));
  }, [state.editingBedId, toggleBlockBed]);

  return useMemo(
    () => ({
      ...state,
      isBlockingDialogOpen: state.blockingBedId !== null,
      isEditingDialogOpen: state.editingBedId !== null,
      isAnyDialogOpen: hasBedManagerDialogOpen(state),
      handleBedClick,
      handleReasonChange,
      confirmBlock,
      cancelBlock,
      closeEditDialog,
      saveReason,
      unblockBed,
    }),
    [
      cancelBlock,
      closeEditDialog,
      confirmBlock,
      handleBedClick,
      handleReasonChange,
      saveReason,
      state,
      unblockBed,
    ]
  );
};
