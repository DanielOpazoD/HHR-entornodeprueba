import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';
import type { CensusMovementSectionModel } from '@/features/census/types/censusMovementSectionModelTypes';
import { resolveMovementSectionState } from '../controllers/censusMovementSectionController';
import { useMovementSectionActions } from './useMovementSectionActions';

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
  const actions = useMovementSectionActions({
    undoDialog,
    undoErrorTitle,
    onUndo,
    deleteDialog,
    deleteErrorTitle,
    onDelete,
  });

  return { ...sectionState, ...actions };
};
