import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { BaseModal } from '@/components/shared/BaseModal';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PatientActionMenu } from '@/features/census/components/patient-row/PatientActionMenu';

const MenuWithModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <PatientActionMenu
        isBlocked={false}
        onAction={() => setIsOpen(true)}
        onViewDemographics={vi.fn()}
        onViewHistory={() => setIsOpen(true)}
      />
      <BaseModal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Acción de prueba">
        <input aria-label="Dato de prueba" />
      </BaseModal>
    </>
  );
};

describe('PatientActionMenu', () => {
  it('shows an anchored loading state while the actions menu code loads', () => {
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <PatientActionMenu
                isBlocked={false}
                onAction={vi.fn()}
                onViewDemographics={vi.fn()}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Acciones'));

    const loadingState = screen.getByRole('status');
    expect(loadingState).toHaveTextContent('Cargando acciones…');
    expect(loadingState.closest('[data-testid="patient-row-menu-portal"]')).toHaveProperty(
      'parentElement',
      document.body
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the demographics icon visible for specialist access without opening demographics', () => {
    const onViewDemographics = vi.fn();

    render(
      <PatientActionMenu
        isBlocked={false}
        readOnly={true}
        accessProfile="specialist"
        hasClinicalDocument={true}
        isNewAdmission={false}
        onAction={vi.fn()}
        onViewDemographics={onViewDemographics}
        onViewClinicalDocuments={vi.fn()}
        onViewExamRequest={vi.fn()}
        onViewImagingRequest={vi.fn()}
      />
    );

    const demographicsButton = screen.getByTitle('Datos del Paciente');
    expect(demographicsButton).toBeInTheDocument();

    fireEvent.click(demographicsButton);
    expect(onViewDemographics).not.toHaveBeenCalled();
  });

  it('does not render the quick actions trigger when the row has no patient identity yet', () => {
    render(
      <PatientActionMenu
        isBlocked={false}
        readOnly={false}
        hasPatientIdentity={false}
        hasClinicalDocument={false}
        isNewAdmission={false}
        onAction={vi.fn()}
        onViewDemographics={vi.fn()}
      />
    );

    expect(screen.queryByTitle('Acciones')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /acciones clínicas rápidas/i })
    ).not.toBeInTheDocument();
  });
  it('opens by keyboard and restores its trigger on Escape and outside close', async () => {
    const user = userEvent.setup();
    render(<MenuWithModal />);
    const trigger = screen.getByRole('button', { name: 'Acciones' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Ver Historial' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('menuitem', { name: 'Limpiar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Ver Historial' })).toHaveFocus();
    await user.click(document.body);
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const demographics = screen.getByRole('button', { name: 'Datos del Paciente' });
    await user.click(demographics);
    expect(demographics).toHaveFocus();
  });

  it.each(['Ver Historial', 'Dar de Alta'])(
    'restores the row trigger after the %s modal closes',
    async name => {
      const user = userEvent.setup();
      render(<MenuWithModal />);
      const trigger = screen.getByRole('button', { name: 'Acciones' });
      trigger.focus();
      await user.keyboard('{Enter}');
      const item = await screen.findByRole('menuitem', { name });
      item.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('textbox', { name: 'Dato de prueba' })).toHaveFocus();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(trigger).toHaveFocus();
    }
  );
});
