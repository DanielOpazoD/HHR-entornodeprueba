import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/rayen-import', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import')>();
  return {
    ...actual,
    requestClinicalPanel: (...args: unknown[]) => mocks.request(...args),
    requestRayenEncounterNavigation: (...args: unknown[]) => mocks.navigate(...args),
  };
});

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

import { ClinicalPanelDrawer } from '@/features/census/components/patient-row/ClinicalPanelDrawer';

const panelResult = {
  events: [
    {
      publishDatetime: '2026-07-13T10:00:00',
      evolutionResume: [
        {
          id: 1,
          OBE_NOTES: 'Evolución médica estable.',
          HCPR_NAME: 'Médico',
          OBE_PUBLISH_DATETIME: '2026-07-13T09:00:00',
        },
      ],
      shiftChangeResume: [
        {
          ID: 2,
          OBSERVATION: 'Entrega médica: controlar laboratorio.',
          HCPR_NAME: 'Médico',
          PUBLISH_DATETIME: '2026-07-13T10:00:00',
        },
        {
          ID: 3,
          OBSERVATION: 'Entrega enfermería: sin novedades.',
          HCPR_NAME: 'Enfermera(o)',
          PUBLISH_DATETIME: '2026-07-13T11:00:00',
        },
      ],
      patientPharmaIndicationResume: [
        {
          MRE_ID: 7,
          DESCRIPTOR: 'CEFTRIAXONA 2 g',
          POSOLOGY: '2 g cada 24 h',
          PUBLISH_DATETIME: '2026-07-13T08:00:00',
          IS_NEW: true,
          SUSPENDED: true,
        },
        {
          MRE_ID: 8,
          DESCRIPTOR: 'AMOXICILINA 500 mg',
          PUBLISH_DATETIME: '2026-07-13T08:30:00',
          SUSPENDED: false,
          FINALIZED: true,
        },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    },
  ],
  carePlan: {
    medicationStates: [
      { id: 7, suspended: true, archived: false },
      { id: 8, suspended: false, archived: false, finalized: true },
    ],
    carePlanHeaders: [
      {
        scheduledDate: '2026-07-13T00:00:00',
        carePlanBody: [
          {
            entryGuid: 'care-1',
            title: 'Cambio de posición',
            isPerformed: true,
            administrationDate: '2026-07-13T12:00:00',
            user: 'ANA PÉREZ',
          },
        ],
      },
    ],
  },
};

describe('ClinicalPanelDrawer', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelResult);
    mocks.navigate.mockReset();
    mocks.navigate.mockResolvedValue({ ok: true, reused: true });
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it('separates handoffs, labels inactive medications, and renders care execution', async () => {
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('Evolución médica estable.')).toBeInTheDocument());
    expect(mocks.request).toHaveBeenCalledWith('141121');
    expect(screen.queryByText('Entrega médica: controlar laboratorio.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Entrega de turno (1)' }));
    expect(screen.getByText('Entrega médica: controlar laboratorio.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enfermería (1)' }));
    expect(screen.getByText('Entrega enfermería: sin novedades.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Indicaciones/i }));
    expect(screen.queryByText('Nueva')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2 inactivas/i }));
    expect(screen.getByText('Suspendida')).toBeInTheDocument();
    expect(screen.getByText('Finalizada')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cuidados/i }));
    expect(screen.getByText('Cambio de posición')).toBeInTheDocument();
    expect(screen.getByText('Ejecutada')).toBeInTheDocument();
    expect(screen.getByText('1/1 ejecutadas')).toBeInTheDocument();
  });

  it('fails closed instead of rendering partial clinical data alongside an error', async () => {
    mocks.request.mockResolvedValue({
      ...panelResult,
      error: 'No se pudieron obtener los medicamentos activos.',
    });

    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(
      await screen.findByText('No se pudieron obtener los medicamentos activos.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Evolución médica estable.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('exposes enabled lateral patient navigation in the drawer header', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        canNavigatePrevious
        canNavigateNext
        onNavigatePrevious={onPrevious}
        onNavigateNext={onNext}
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Evolución médica estable.');
    fireEvent.click(screen.getByRole('button', { name: 'Ir al paciente anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir al paciente siguiente' }));

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('opens hospitalization reports from the drawer header', async () => {
    const onOpenHospitalizationReports = vi.fn();
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        onOpenHospitalizationReports={onOpenHospitalizationReports}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Evolución médica estable.');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Abrir informes de hospitalización de Paciente de prueba',
      })
    );

    expect(onOpenHospitalizationReports).toHaveBeenCalledOnce();
  });

  it('opens the exact episode from the Rayen mark beside the patient name', async () => {
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        encounterRouteHint="nurse"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'Abrir a Paciente de prueba en Eloísa' });
    expect(button.querySelector('img')).toHaveAttribute('src', '/images/logos/rayen-mark.png');
    fireEvent.click(button);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('141121', 8000, 'nurse'));
    expect(mocks.success).toHaveBeenCalledWith(
      'Eloísa abierta',
      'Se activó la pestaña de Ficha Médico en el episodio seleccionado.'
    );
  });
});
