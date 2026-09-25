import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BaseModal } from '@/components/shared/BaseModal';
import { ClinicalPanelDrawer } from '@/features/census/components/patient-row/ClinicalPanelDrawer';

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/features/census/components/patient-row/useClinicalPanelSnapshot', () => ({
  useClinicalPanelSnapshot: () => ({
    state: { phase: 'loading' },
    documentState: { phase: 'loading' },
    reload: vi.fn(),
  }),
}));

const renderDrawer = (onClose = vi.fn()) =>
  render(
    <ClinicalPanelDrawer
      bedId="R1"
      patientName="Paciente de prueba"
      clinicalEpisodeId="141121"
      onOpenHospitalizationReports={vi.fn()}
      onClose={onClose}
    />
  );

describe('ClinicalPanelDrawer loading and modal layering', () => {
  it('uses one branded progress indicator and leaves refresh still', () => {
    renderDrawer();
    const loading = screen.getByRole('status');
    expect(within(loading).getByText('Consultando Ficha Médico…')).toBeInTheDocument();
    expect(loading.querySelector('img')).toHaveAttribute('src', '/images/logos/logo_HHR.png');
    expect(loading.querySelector('img')).toHaveClass('animate-pulse');
    expect(screen.getByTestId('clinical-panel-content').querySelector('.animate-spin')).toBeNull();
    const refresh = screen.getByRole('button', { name: 'Actualizar panel clínico' });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector('.animate-spin')).toBeNull();
  });

  it('leaves the drawer open when Escape closes the reports modal above it', () => {
    const closeDrawer = vi.fn();
    const closeModal = vi.fn();
    render(
      <>
        <ClinicalPanelDrawer
          bedId="R1"
          patientName="Paciente de prueba"
          clinicalEpisodeId="141121"
          onOpenHospitalizationReports={vi.fn()}
          onClose={closeDrawer}
        />
        <BaseModal isOpen onClose={closeModal} title="Informes de hospitalización">
          <button type="button">Descargar</button>
        </BaseModal>
      </>
    );

    const modal = screen.getByRole('dialog', { name: 'Informes de hospitalización' });
    modal.focus();
    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(closeModal).toHaveBeenCalledOnce();
    expect(closeDrawer).not.toHaveBeenCalled();
  });
});
