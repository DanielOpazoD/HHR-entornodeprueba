import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminCudyrBulkRemovalToolbar } from '@/features/cudyr/components/AdminCudyrBulkRemovalToolbar';

const activeProps = {
  availableCount: 12,
  selectedCount: 2,
  isActive: true,
  isBusy: false,
  onStart: vi.fn(),
  onCancel: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onConfirmRemoval: vi.fn().mockResolvedValue(true),
};

describe('AdminCudyrBulkRemovalToolbar', () => {
  it('offers the bulk action only when imported results are available', () => {
    const { rerender } = render(<AdminCudyrBulkRemovalToolbar {...activeProps} isActive={false} />);

    expect(screen.getByText('Eliminar varios resultados')).toBeInTheDocument();
    rerender(<AdminCudyrBulkRemovalToolbar {...activeProps} availableCount={0} isActive={false} />);
    expect(screen.queryByText('Eliminar varios resultados')).not.toBeInTheDocument();
  });

  it('selects all available results and allows clearing the selection', () => {
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    const { rerender } = render(
      <AdminCudyrBulkRemovalToolbar
        {...activeProps}
        selectedCount={2}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
      />
    );

    fireEvent.click(screen.getByText('Seleccionar todos'));
    expect(onSelectAll).toHaveBeenCalledOnce();

    rerender(
      <AdminCudyrBulkRemovalToolbar
        {...activeProps}
        selectedCount={12}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByText('Deseleccionar todos'));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation and describes preserved clinical scores', async () => {
    const onConfirmRemoval = vi.fn().mockResolvedValue(true);
    render(<AdminCudyrBulkRemovalToolbar {...activeProps} onConfirmRemoval={onConfirmRemoval} />);

    fireEvent.click(screen.getByText('Eliminar seleccionados'));
    expect(screen.getByText('¿Eliminar 2 resultados CUDYR?')).toBeInTheDocument();
    expect(screen.getByText(/Braden, Downton y los puntajes CUDYR locales/)).toBeInTheDocument();
    expect(onConfirmRemoval).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('admin-cudyr-bulk-confirm'));
    expect(onConfirmRemoval).toHaveBeenCalledOnce();
  });

  it('keeps cancellation available if all targets disappear during selection', () => {
    const onCancel = vi.fn();
    render(
      <AdminCudyrBulkRemovalToolbar
        {...activeProps}
        availableCount={0}
        selectedCount={0}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables final confirmation when the last selected target is cleared', () => {
    const { rerender } = render(
      <AdminCudyrBulkRemovalToolbar {...activeProps} selectedCount={1} />
    );

    fireEvent.click(screen.getByText('Eliminar seleccionados'));
    rerender(<AdminCudyrBulkRemovalToolbar {...activeProps} selectedCount={0} />);
    expect(screen.getByTestId('admin-cudyr-bulk-confirm')).toBeDisabled();
  });
});
