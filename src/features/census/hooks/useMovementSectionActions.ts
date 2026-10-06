import { useCallback } from 'react';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useConfirmedMovementAction } from '@/features/census/hooks/useConfirmedMovementAction';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';

interface UseMovementSectionActionsParams {
  undoDialog: ControllerConfirmDescriptor;
  undoErrorTitle: string;
  onUndo: (id: string) => void | Promise<void>;
  deleteDialog: ControllerConfirmDescriptor;
  deleteErrorTitle: string;
  onDelete: (id: string) => void | Promise<void>;
}

interface UseMovementSectionActionsResult {
  handleUndo: (id: string) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export const useMovementSectionActions = ({
  undoDialog,
  undoErrorTitle,
  onUndo,
  deleteDialog,
  deleteErrorTitle,
  onDelete,
}: UseMovementSectionActionsParams): UseMovementSectionActionsResult => {
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();
  const runConfirmedAction = useConfirmedMovementAction({ confirm, notifyError });

  const handleUndo = useCallback(
    async (id: string) => {
      await runConfirmedAction({
        dialog: undoDialog,
        errorTitle: undoErrorTitle,
        run: () => onUndo(id),
      });
    },
    [onUndo, runConfirmedAction, undoDialog, undoErrorTitle]
  );
  const handleDelete = useCallback(
    async (id: string) => {
      await runConfirmedAction({
        dialog: deleteDialog,
        errorTitle: deleteErrorTitle,
        run: () => onDelete(id),
      });
    },
    [deleteDialog, deleteErrorTitle, onDelete, runConfirmedAction]
  );
  return { handleUndo, handleDelete };
};
