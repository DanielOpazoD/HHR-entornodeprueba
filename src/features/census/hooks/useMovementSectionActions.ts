import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useConfirmedMovementAction } from '@/features/census/hooks/useConfirmedMovementAction';
import { useMovementSectionConfirmHandlers } from '@/features/census/hooks/useMovementSectionConfirmHandlers';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

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

  return useMovementSectionConfirmHandlers({
    runConfirmedAction,
    undoDialog,
    undoErrorTitle,
    onUndo,
    deleteDialog,
    deleteErrorTitle,
    onDelete,
  });
};
