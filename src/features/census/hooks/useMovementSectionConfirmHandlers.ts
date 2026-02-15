import React from 'react';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

interface ConfirmedMovementRunnerParams {
  dialog: ControllerConfirmDescriptor;
  errorTitle: string;
  run: () => void | Promise<void>;
}

interface UseMovementSectionConfirmHandlersParams {
  runConfirmedAction: (params: ConfirmedMovementRunnerParams) => Promise<void>;
  undoDialog: ControllerConfirmDescriptor;
  undoErrorTitle: string;
  onUndo: (id: string) => void | Promise<void>;
  deleteDialog: ControllerConfirmDescriptor;
  deleteErrorTitle: string;
  onDelete: (id: string) => void | Promise<void>;
}

interface UseMovementSectionConfirmHandlersResult {
  handleUndo: (id: string) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export const useMovementSectionConfirmHandlers = ({
  runConfirmedAction,
  undoDialog,
  undoErrorTitle,
  onUndo,
  deleteDialog,
  deleteErrorTitle,
  onDelete,
}: UseMovementSectionConfirmHandlersParams): UseMovementSectionConfirmHandlersResult => {
  const handleUndo = React.useCallback(
    async (id: string) => {
      await runConfirmedAction({
        dialog: undoDialog,
        errorTitle: undoErrorTitle,
        run: () => onUndo(id),
      });
    },
    [onUndo, runConfirmedAction, undoDialog, undoErrorTitle]
  );

  const handleDelete = React.useCallback(
    async (id: string) => {
      await runConfirmedAction({
        dialog: deleteDialog,
        errorTitle: deleteErrorTitle,
        run: () => onDelete(id),
      });
    },
    [deleteDialog, deleteErrorTitle, onDelete, runConfirmedAction]
  );

  return {
    handleUndo,
    handleDelete,
  };
};
