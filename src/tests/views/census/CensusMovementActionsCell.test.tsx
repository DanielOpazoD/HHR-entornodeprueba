import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { resolveMenuPosition } from '@/features/census/components/CensusMovementActionsMenu';

describe('CensusMovementActionsCell', () => {
  const context = { bedName: 'R6', patientName: 'Paciente Sintético' };
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders movement actions and calls handlers by title', () => {
    const onUndo = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementActionsCell
              context={context}
              actions={[
                {
                  kind: 'undo',
                  title: 'Deshacer (Restaurar a Cama)',
                  onClick: onUndo,
                },
                { kind: 'edit', title: 'Editar', onClick: onEdit },
                {
                  kind: 'delete',
                  title: 'Eliminar Registro',
                  onClick: onDelete,
                },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deshacer (Restaurar a Cama)' }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar Registro' }));

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
              context={context}
              actions={[
                {
                  kind: 'convert',
                  title: 'Convertir a CMA',
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

  it('remeasures the mounted portal before placing the menu near the viewport bottom', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.querySelector('[title="Abrir menú de acciones"]')) {
        return new DOMRect(620, 700, 40, 32);
      }
      if (this.getAttribute('role') === 'menu') {
        return new DOMRect(0, 0, 160, 180);
      }
      return new DOMRect();
    });

    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 768);

    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementActionsCell
              context={context}
              actions={[
                {
                  kind: 'convert',
                  title: 'Convertir a CMA',
                  onClick: vi.fn(),
                },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));

    await waitFor(() => {
      expect(screen.getByRole('menu')).toHaveStyle({ top: '516px' });
    });
  });

  it('keeps the menu inside the viewport when its trigger is at the left edge', () => {
    const anchorRect = new DOMRect(0, 120, 40, 32);
    const menuRect = new DOMRect(0, 0, 160, 180);

    const position = resolveMenuPosition(anchorRect, menuRect, {
      width: 1280,
      height: 768,
    });

    expect(position.top).toBe('156px');
    expect(position.right).toBe('1112px');
  });

  it('keeps the wider patient menu within a mobile viewport', () => {
    const position = resolveMenuPosition(
      new DOMRect(180, 120, 44, 44),
      new DOMRect(0, 0, 256, 240),
      { width: 375, height: 812 }
    );

    expect(position.right).toBe('111px');
    expect(position.top).toBe('168px');
  });

  it('identifies the patient and separates undo/delete after consultation and editing', () => {
    const selected = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementActionsCell
              context={context}
              actions={[
                { kind: 'undo', title: 'Deshacer', onClick: vi.fn() },
                { kind: 'viewDocuments', title: 'Consultar', onClick: vi.fn() },
                { kind: 'edit', title: 'Editar', onClick: selected },
                { kind: 'convert', title: 'Convertir', onClick: vi.fn() },
                { kind: 'delete', title: 'Eliminar', onClick: vi.fn() },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('R6')).toBeVisible();
    expect(within(menu).getByText('Paciente Sintético')).toBeVisible();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map(item => item.textContent)
    ).toEqual(['Consultar', 'Editar', 'Convertir', 'Deshacer', 'Eliminar']);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Editar' }));
    expect(selected).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
