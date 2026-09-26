import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reportsGate = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  return { pending, release };
});

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({
    onOpenHospitalizationReports,
  }: {
    onOpenHospitalizationReports: () => void;
  }) => (
    <aside role="dialog">
      <button type="button" onClick={onOpenHospitalizationReports}>
        Abrir informes
      </button>
    </aside>
  ),
}));

vi.mock('@/features/census/components/PatientHospitalizationReportsDialog', async () => {
  await reportsGate.pending;
  return {
    PatientHospitalizationReportsDialog: () => (
      <div role="dialog" data-testid="reports-ready">
        Informes cargados
      </div>
    ),
  };
});

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

describe('deferred hospitalization reports', () => {
  it('keeps the modal available while its module loads and allows Escape to close it', async () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
    );
    const openReports = await screen.findByRole('button', { name: 'Abrir informes' });
    openReports.focus();
    fireEvent.click(openReports);

    const loadingModal = screen.getByTestId('reports-module-loading');
    expect(loadingModal).toHaveTextContent('Paciente de prueba');
    expect(loadingModal.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(loadingModal.parentElement).toHaveStyle({ zIndex: 10000 });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('reports-module-loading')).not.toBeInTheDocument();
    expect(openReports).toHaveFocus();

    fireEvent.click(openReports);
    expect(screen.getByTestId('reports-module-loading')).toBeInTheDocument();
    reportsGate.release();
    expect(await screen.findByTestId('reports-ready')).toHaveTextContent('Informes cargados');
    expect(screen.queryByTestId('reports-module-loading')).not.toBeInTheDocument();
  });
});
