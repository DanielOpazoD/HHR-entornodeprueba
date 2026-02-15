import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

interface MovementRowActionHandlers<TItem extends { id: string }> {
  onUndo: (id: string) => void | Promise<void>;
  onEdit: (item: TItem) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

interface MovementRowActionTitles {
  undo: string;
  edit: string;
  delete: string;
}

const DEFAULT_ACTION_TITLES: MovementRowActionTitles = {
  undo: 'Deshacer (Restaurar a Cama)',
  edit: 'Editar',
  delete: 'Eliminar Registro',
};

export const buildMovementRowActions = <TItem extends { id: string }>(
  item: TItem,
  handlers: MovementRowActionHandlers<TItem>,
  titles: MovementRowActionTitles = DEFAULT_ACTION_TITLES
): CensusMovementActionDescriptor[] => [
  {
    kind: 'undo',
    title: titles.undo,
    className: 'text-slate-400 hover:text-slate-600',
    onClick: () => {
      void handlers.onUndo(item.id);
    },
  },
  {
    kind: 'edit',
    title: titles.edit,
    className: 'text-medical-500 hover:text-medical-700',
    onClick: () => {
      void handlers.onEdit(item);
    },
  },
  {
    kind: 'delete',
    title: titles.delete,
    className: 'text-red-400 hover:text-red-600',
    onClick: () => {
      void handlers.onDelete(item.id);
    },
  },
];
