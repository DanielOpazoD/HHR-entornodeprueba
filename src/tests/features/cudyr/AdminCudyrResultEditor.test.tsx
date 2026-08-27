import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminCudyrResultEditor } from '@/features/cudyr/components/AdminCudyrResultEditor';
import { CUDYR_RESULT_OPTIONS } from '@/domain/cudyr/adminCudyrResult';

describe('AdminCudyrResultEditor', () => {
  it('offers only the twelve controlled CUDYR results and no free-text field', () => {
    render(<AdminCudyrResultEditor currentCategory="C1" onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const select = screen.getByRole('combobox', { name: 'Resultado CUDYR administrativo' });
    const options = Array.from((select as HTMLSelectElement).options).map(option => option.value);

    expect(options).toEqual(['', ...CUDYR_RESULT_OPTIONS, '__remove__']);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('stages a category and writes it only after explicit save', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<AdminCudyrResultEditor currentCategory="C1" onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'D3' } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('D3'));
  });

  it('uses an explicit destructive action and sends null when deleting', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<AdminCudyrResultEditor currentCategory="B1" onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__remove__' } });
    expect(screen.getByText(/Se eliminará sólo el resultado CUDYR importado/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });
});
