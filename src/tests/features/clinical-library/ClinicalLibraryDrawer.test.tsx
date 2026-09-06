import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalLibraryDrawer } from '@/features/clinical-library/components/ClinicalLibraryDrawer';

const renderDrawer = (
  overrides: Partial<React.ComponentProps<typeof ClinicalLibraryDrawer>> = {}
) => {
  const onClose = vi.fn();
  const documentActions = { print: vi.fn() };
  render(
    <ClinicalLibraryDrawer onClose={onClose} documentActions={documentActions} {...overrides} />
  );
  return { onClose, documentActions };
};

describe('ClinicalLibraryDrawer', () => {
  it('opens as a labelled dialog with the search focused and every category visible', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Documentos y herramientas' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByRole('searchbox', { name: 'Buscar en documentos y herramientas' })
    ).toHaveFocus();

    expect(screen.getByRole('button', { name: /^Todo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Formularios' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Protocolos' })).toBeInTheDocument();
    expect(screen.getByText('Aún no hay protocolos publicados')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay infografías publicadas')).toBeInTheDocument();
    expect(screen.getByTestId('library-tool-infusion')).toBeInTheDocument();
    expect(screen.getByTestId('library-document-consentimiento-informado')).toBeInTheDocument();
  });

  it('filters accent-insensitively and hides empty groups while searching', () => {
    renderDrawer();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'imagenologia' } });
    expect(screen.getByTestId('library-document-solicitud-imagenologia')).toBeInTheDocument();
    expect(
      screen.queryByTestId('library-document-consentimiento-informado')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Aún no hay protocolos publicados')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('Sin resultados para «zzz»')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('narrows the list with the category chips', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /^Herramientas/ }));
    expect(screen.getByRole('button', { name: /^Herramientas/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('library-tool-scores')).toBeInTheDocument();
    expect(
      screen.queryByTestId('library-document-consentimiento-informado')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Formularios' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Protocolos/ }));
    expect(screen.getByText('Aún no hay protocolos publicados')).toBeInTheDocument();
  });

  it('prints PDFs through the injected handler and downloads Word templates', () => {
    const { documentActions } = renderDrawer();
    const consent = within(screen.getByTestId('library-document-consentimiento-informado'));
    fireEvent.click(consent.getByRole('button', { name: /^Imprimir/ }));
    expect(documentActions.print).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'consentimiento-informado' })
    );
    expect(consent.queryByRole('link')).not.toBeInTheDocument();
    expect(consent.getAllByRole('button')).toHaveLength(1);

    const vmi = within(screen.getByTestId('library-document-planilla-monitorizacion-ventilatoria'));
    expect(vmi.queryByRole('button')).not.toBeInTheDocument();
    expect(vmi.getByRole('link', { name: /^Descargar/ })).toHaveAttribute(
      'href',
      '/docs/biblioteca/planilla-monitorizacion-ventilatoria-vmi.docx'
    );
  });

  it('opens a tool in place, hides the search while inside and returns to the list', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('library-tool-infusion'));
    expect(screen.getByTestId('library-tool-infusion')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Volver a la biblioteca' }));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByTestId('library-document-consentimiento-informado')).toBeInTheDocument();
  });

  it('can start directly inside a tool', () => {
    renderDrawer({ initialToolId: 'scores' });
    expect(screen.getByTestId('library-tool-scores')).toBeInTheDocument();
  });

  it('closes with Escape, the overlay and the close button', () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('clinical-library-overlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar documentos' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('steps back to the list instead of closing while a tool is open', () => {
    const { onClose } = renderDrawer({ initialToolId: 'infusion' });
    fireEvent.change(screen.getByLabelText('Dosis indicada'), { target: { value: '0,1' } });
    fireEvent.keyDown(screen.getByLabelText('Dosis indicada'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-tool-scores'));
    fireEvent.click(screen.getByTestId('clinical-library-overlay'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar documentos' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab navigation inside the dialog', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});
