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
      <input aria-label="Borrador local" defaultValue="Edición pendiente" />
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
  it('keeps an offline chunk failure above the drawer without losing the local draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
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
    const draft = screen.getByRole('textbox', { name: 'Borrador local' });
    fireEvent.change(draft, { target: { value: 'Texto editado sin guardar' } });
    openPanel();
    const openReports = await screen.findByRole('button', { name: 'Abrir informes' });
    openReports.focus();
    fireEvent.click(openReports);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir este panel');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
    expect(draft).toHaveValue('Texto editado sin guardar');
    expect(screen.getByTestId('reports-module-loading').parentElement).toHaveStyle({
      zIndex: '10000',
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(openReports).toHaveFocus();

    vi.doMock('@/features/census/components/PatientHospitalizationReportsDialog', () => ({
      PatientHospitalizationReportsDialog: () => <div role="dialog">Informes recuperados</div>,
    }));
    fireEvent.click(openReports);
    expect(await screen.findByText('Informes recuperados')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Borrador local' })).toBe(draft);
    expect(draft).toHaveValue('Texto editado sin guardar');
    expect(screen.getByRole('button', { name: 'Guardar censo' })).toBeEnabled();
  });
});
