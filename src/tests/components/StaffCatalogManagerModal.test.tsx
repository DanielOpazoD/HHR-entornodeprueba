import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffCatalogManagerModal } from '@/components/modals/StaffCatalogManagerModal';

vi.mock('../../hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

describe('StaffCatalogManagerModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['nurse', 'tens'] as const)('adds staff through the named icon for %s', variant => {
    const onSave = vi.fn();
    render(
      <StaffCatalogManagerModal
        isOpen
        onClose={vi.fn()}
        staffList={[]}
        onSave={onSave}
        syncing={false}
        hasSyncError={false}
        variant={variant}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
      target: { value: 'Persona Sintética' },
    });
    const button = screen.getByRole('button', { name: 'Agregar personal' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledWith(['Persona Sintética'], expect.any(Array));
  });

  it('shows nurse empty state when no records are provided', () => {
    render(
      <StaffCatalogManagerModal
        isOpen={true}
        onClose={() => {}}
        staffList={[]}
        onSave={vi.fn()}
        syncing={false}
        hasSyncError={false}
        variant="nurse"
      />
    );

    expect(screen.getByText('No hay enfermeros registrados')).toBeTruthy();
  });

  it('adds a validated staff name and trims whitespace', () => {
    const onSave = vi.fn();
    render(
      <StaffCatalogManagerModal
        isOpen={true}
        onClose={() => {}}
        staffList={['Ana']}
        onSave={onSave}
        syncing={false}
        hasSyncError={false}
        variant="tens"
      />
    );

    const input = screen.getByPlaceholderText('Nombre completo…');
    fireEvent.change(input, { target: { value: '   Maria   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith(['Ana', 'Maria'], expect.any(Array));
  });

  it('shows validation error when trying to add an invalid name', () => {
    const onSave = vi.fn();
    render(
      <StaffCatalogManagerModal
        isOpen={true}
        onClose={() => {}}
        staffList={[]}
        onSave={onSave}
        syncing={false}
        hasSyncError={false}
        variant="nurse"
      />
    );

    const input = screen.getByPlaceholderText('Nombre completo…');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('El nombre debe tener al menos 2 caracteres')).toBeTruthy();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: 'Persona Sintética' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports edit and delete actions', async () => {
    const onSave = vi.fn();
    render(
      <StaffCatalogManagerModal
        isOpen={true}
        onClose={() => {}}
        staffList={['Ana']}
        onSave={onSave}
        syncing={false}
        hasSyncError={false}
        variant="nurse"
      />
    );

    fireEvent.click(screen.getByTitle('Editar'));
    const editInput = screen.getByDisplayValue('Ana');
    fireEvent.change(editInput, { target: { value: 'Ana María' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(['Ana María'], expect.any(Array));

    await waitFor(() => expect(screen.queryByTitle('Guardar')).not.toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Eliminar'));
    expect(onSave).toHaveBeenCalledWith([], expect.any(Array));
  });
});
