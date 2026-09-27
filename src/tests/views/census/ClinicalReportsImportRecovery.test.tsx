import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

const patient = {
  bedId: 'R2',
  patientName: 'Paciente de prueba',
  patientRun: '1-9',
  clinicalEpisodeId: 'episode-test',
};

const openPanel = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
  );

const renderCensus = () =>
  render(
    <>
      <button>Guardar censo</button>
      <ClinicalPanelTrigger {...patient} />
    </>
  );

afterEach(() => {
  vi.doUnmock('@/features/census/components/patient-row/ClinicalPanelDrawer');
  vi.doUnmock('@/features/census/components/PatientHospitalizationReportsDialog');
  vi.restoreAllMocks();
});

describe('reports import recovery', () => {
  it('keeps a failed reports panel above the drawer, dismisses it and retries on reopen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
      ClinicalPanelDrawer: ({
        onOpenHospitalizationReports,
      }: {
        onOpenHospitalizationReports: () => void;
      }) => (
        <aside role="dialog">
          <button onClick={onOpenHospitalizationReports}>Abrir informes</button>
        </aside>
      ),
    }));
    vi.doMock('@/features/census/components/PatientHospitalizationReportsDialog', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    renderCensus();
    openPanel();
    const openReports = await screen.findByRole('button', { name: 'Abrir informes' });
    openReports.focus();
    fireEvent.click(openReports);
    await screen.findByRole('alert');
    expect(screen.getByTestId('reports-module-loading').parentElement).toHaveStyle({
      zIndex: 10000,
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(openReports).toHaveFocus();

    vi.doMock('@/features/census/components/PatientHospitalizationReportsDialog', () => ({
      PatientHospitalizationReportsDialog: () => <div role="dialog">Informes recuperados</div>,
    }));
    fireEvent.click(openReports);
    expect(await screen.findByText('Informes recuperados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar censo' })).toBeEnabled();
  });
});
