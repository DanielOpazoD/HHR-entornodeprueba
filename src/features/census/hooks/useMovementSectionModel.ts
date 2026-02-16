import { resolveMovementSectionState } from '@/features/census/controllers/censusMovementSectionController';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';
import type { CensusMovementSectionModel } from '@/features/census/types/censusMovementSectionModelTypes';

interface UseMovementSectionModelParams<TItem> {
  items: TItem[] | null | undefined;
  undoDialog: ControllerConfirmDescriptor;
  undoErrorTitle: string;
  onUndo: (id: string) => void | Promise<void>;
  deleteDialog: ControllerConfirmDescriptor;
  deleteErrorTitle: string;
  onDelete: (id: string) => void | Promise<void>;
}

interface UseMovementSectionModelResult<TItem> extends CensusMovementSectionModel<TItem> {
  handleUndo: (id: string) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export const useMovementSectionModel = <TItem>({
  items,
  undoDialog,
  undoErrorTitle,
  onUndo,
  deleteDialog,
  deleteErrorTitle,
  onDelete,
}: UseMovementSectionModelParams<TItem>): UseMovementSectionModelResult<TItem> => {
  const sectionState = resolveMovementSectionState(items);
  const { handleUndo, handleDelete } = useMovementSectionActions({
    undoDialog,
    undoErrorTitle,
    onUndo,
    deleteDialog,
    deleteErrorTitle,
    onDelete,
  });

  return {
    isRenderable: sectionState.isRenderable,
    isEmpty: sectionState.isEmpty,
    items: sectionState.items,
    handleUndo,
    handleDelete,
  };
};
