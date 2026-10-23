import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseModal } from '@/components/shared/BaseModal';
import { ClinicalDocumentPharmacyForms } from '@/features/clinical-documents/components/ClinicalDocumentPharmacyForms';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'pharmacy-test', displayName: 'Profesional de prueba', role: 'admin' },
  }),
}));
vi.mock('@/services/user-profile/sessionProfessionalIdentity', () => ({
  readSessionProfessionalIdentity: () => null,
}));

const openWorkspace = () => {
  const onClose = vi.fn();
  render(
    <BaseModal isOpen onClose={onClose} title="Documentos Clínicos">
      <ClinicalDocumentPharmacyForms />
    </BaseModal>
  );
  return onClose;
};

const openForm = async (opener: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(opener);
    await vi.dynamicImportSettled();
  });
};

describe('pharmacy forms inside clinical documents', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['Acta de devolución de fármacos', 'return'],
    ['Acta de entrega de fármacos eliminados', 'disposal'],
  ])('opens %s and returns focus without closing clinical documents', async (label, kind) => {
    const onClose = openWorkspace();
    const opener = screen.getByRole('button', { name: label });
    await openForm(opener);
    const editor = await screen.findByTestId(`library-tool-pharmacy-${kind}`);
    expect(within(editor).getByLabelText('Nombre del responsable')).toHaveValue(
      'Profesional de prueba'
    );
    expect(
      within(editor).getByRole('searchbox', { name: 'Buscar fármaco o insumo' })
    ).toBeVisible();
    expect(within(editor).getByLabelText('Tamaño de papel')).toBeVisible();
    fireEvent.click(within(editor).getByRole('button', { name: 'Cerrar documentos' }));
    await waitFor(() => expect(screen.queryByTestId(`library-tool-pharmacy-${kind}`)).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Documentos Clínicos' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it('keeps the act and parent open when Escape is canceled, then confirms only the act close', async () => {
    const onClose = openWorkspace();
    const opener = screen.getByRole('button', { name: 'Acta de devolución de fármacos' });
    await openForm(opener);
    const editor = await screen.findByTestId('library-tool-pharmacy-return');
    const name = within(editor).getByLabelText('Nombre del responsable');
    fireEvent.change(name, { target: { value: 'Responsable editado' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    const confirmation = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Seguir editando' }));
    expect(name).toHaveValue('Responsable editado');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole('button', { name: 'Cerrar documentos' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Salir y descartar',
      })
    );
    expect(screen.queryByTestId('clinical-library-drawer')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Documentos Clínicos' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});
