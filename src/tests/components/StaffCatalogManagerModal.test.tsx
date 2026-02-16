import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

    const input = screen.getByPlaceholderText('Nombre completo...');
    fireEvent.change(input, { target: { value: '   Maria   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith(['Ana', 'Maria']);
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

    const input = screen.getByPlaceholderText('Nombre completo...');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('El nombre debe tener al menos 2 caracteres')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports edit and delete actions', () => {
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
    expect(onSave).toHaveBeenCalledWith(['Ana María']);

    fireEvent.click(screen.getByTitle('Eliminar'));
    expect(onSave).toHaveBeenCalledWith([]);
  });
});
