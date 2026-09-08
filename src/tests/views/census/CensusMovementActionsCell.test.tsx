import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { resolveMenuPosition } from '@/features/census/components/CensusMovementActionsMenu';

describe('CensusMovementActionsCell', () => {
  it('renders movement actions and calls handlers by title', () => {
    const onUndo = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementActionsCell
              actions={[
                {
                  kind: 'undo',
                  title: 'Deshacer (Restaurar a Cama)',
                  className: 'undo',
                  onClick: onUndo,
                },
                { kind: 'edit', title: 'Editar', className: 'edit', onClick: onEdit },
                {
                  kind: 'delete',
                  title: 'Eliminar Registro',
                  className: 'delete',
                  onClick: onDelete,
                },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.click(screen.getByTitle('Eliminar Registro'));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders menu presentation in a portal outside the table', () => {
    const onConvert = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementActionsCell
              presentation="menu"
              actions={[
                {
                  kind: 'convert',
                  title: 'Convertir a CMA',
                  className: 'convert',
                  onClick: onConvert,
                },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    const menuItem = screen.getByRole('menuitem', { name: 'Convertir a CMA' });

    expect(menuItem.closest('table')).toBeNull();
    expect(screen.getByRole('menu')).toHaveClass('print:hidden');

    fireEvent.click(menuItem);
    expect(onConvert).toHaveBeenCalledTimes(1);
  });

  it('calculates menu position above the trigger when there is no room below', () => {
    const anchorRect = new DOMRect(620, 700, 40, 32);
    const menuRect = new DOMRect(0, 0, 160, 180);

    const position = resolveMenuPosition(anchorRect, menuRect, {
      width: 1280,
      height: 768,
    });

    expect(position.top).toBe('516px');
    expect(position.right).toBe('616px');
  });

  it('keeps menu anchored to the right when there is room in viewport', () => {
    const anchorRect = new DOMRect(0, 120, 40, 32);
    const menuRect = new DOMRect(0, 0, 160, 180);

    const position = resolveMenuPosition(anchorRect, menuRect, {
      width: 1280,
      height: 768,
    });

    expect(position.top).toBe('156px');
    expect(position.right).toBe('1236px');
  });
});
