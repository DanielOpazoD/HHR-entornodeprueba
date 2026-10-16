import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalLibraryDrawer } from '@/features/clinical-library/components/ClinicalLibraryDrawer';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: null }),
}));

const openDirtyMedif = async () => {
  const onClose = vi.fn();
  render(<ClinicalLibraryDrawer onClose={onClose} initialToolId="medif" />);
  const editor = await screen.findByTestId('library-tool-medif', {}, { timeout: 5000 });
  const input = within(editor).getByLabelText('Nombre completo');
  fireEvent.change(input, { target: { value: 'BORRADOR DE PRUEBA' } });
  return { input, onClose };
};

describe('MEDIF drawer integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  it('cancels Escape and overlay exits without losing the current form', async () => {
    const { input, onClose } = await openDirtyMedif();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('clinical-library-content')).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Seguir editando' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('BORRADOR DE PRUEBA');
    fireEvent.click(screen.getByTestId('clinical-library-overlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(input).toHaveValue('BORRADOR DE PRUEBA');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns to the library only after confirming discard and starts a blank next draft', async () => {
    await openDirtyMedif();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la biblioteca' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir y descartar' }));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('library-tool-medif'));
    const editor = await screen.findByTestId('library-tool-medif');
    expect(within(editor).getByLabelText('Nombre completo')).toHaveValue('');
  });

  it('guards the close button and calls the parent only on confirmed exit', async () => {
    const { onClose } = await openDirtyMedif();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar documentos' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Salir y descartar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
