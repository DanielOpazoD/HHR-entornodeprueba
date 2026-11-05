import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransferInlineField } from '@/features/census/components/TransferInlineField';

describe('inline transfer editing', () => {
  it('waits for persistence, retains failed drafts, and allows retry in the same cell', async () => {
    const pending = Promise.withResolvers<boolean>();
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true);
    render(
      <TransferInlineField
        label="Centro destino"
        value=""
        options={['Hospital Salvador']}
        onSave={save}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar Centro destino' }));
    fireEvent.change(screen.getByLabelText('Centro destino'), {
      target: { value: 'Centro Sintético' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByLabelText('Centro destino')).toHaveValue('Centro Sintético');
    await act(async () => pending.resolve(false));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
    expect(screen.getByLabelText('Centro destino')).toHaveValue('Centro Sintético');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })));
    expect(save).toHaveBeenLastCalledWith('Centro Sintético');
    expect(screen.queryByLabelText('Centro destino')).not.toBeInTheDocument();
  });

  it('cancel does not write and empty values cannot be saved', () => {
    const save = vi.fn();
    render(<TransferInlineField label="Medio de traslado" value="" options={[]} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Medio de traslado' }));
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(save).not.toHaveBeenCalled();
  });
});
