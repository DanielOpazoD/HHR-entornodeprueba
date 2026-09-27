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

describe('clinical panel import recovery', () => {
  it('contains a failed drawer import, retries it and keeps the census usable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    renderCensus();
    openPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir este panel');
    expect(screen.getByTestId('clinical-panel-module-loading')).toHaveAttribute(
      'aria-busy',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Guardar censo' })).toBeEnabled();

    vi.doMock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
      ClinicalPanelDrawer: () => <aside role="dialog">Ficha recuperada</aside>,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Ficha recuperada')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
