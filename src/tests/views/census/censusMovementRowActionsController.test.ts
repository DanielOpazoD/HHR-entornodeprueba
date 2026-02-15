import { describe, expect, it } from 'vitest';
import { buildMovementRowActions } from '@/features/census/controllers/censusMovementRowActionsController';

describe('censusMovementRowActionsController', () => {
  it('builds undo/edit/delete actions and routes identifiers correctly', () => {
    const item = { id: 'x-1', label: 'Item X' };
    let undoId = '';
    let editId = '';
    let deleteId = '';

    const actions = buildMovementRowActions(item, {
      onUndo: id => {
        undoId = id;
      },
      onEdit: current => {
        editId = current.id;
      },
      onDelete: id => {
        deleteId = id;
      },
    });

    expect(actions.map(action => action.kind)).toEqual(['undo', 'edit', 'delete']);
    expect(actions.map(action => action.title)).toEqual([
      'Deshacer (Restaurar a Cama)',
      'Editar',
      'Eliminar Registro',
    ]);

    actions[0].onClick();
    actions[1].onClick();
    actions[2].onClick();

    expect(undoId).toBe('x-1');
    expect(editId).toBe('x-1');
    expect(deleteId).toBe('x-1');
  });
});
