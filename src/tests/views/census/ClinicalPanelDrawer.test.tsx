import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/features/rayen-import', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});

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
          SUSPENDED: false,
        },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    },
  ],
  carePlan: {
    medicationStates: [{ id: 7, suspended: true, archived: false }],
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
  });

  it('separates medical/nursing handoffs, shows canonical suspended medication, and renders care execution', async () => {
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
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
    fireEvent.click(screen.getByRole('button', { name: /1 inactiva/i }));
    expect(screen.getByText('Suspendida')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cuidados/i }));
    expect(screen.getByText('Cambio de posición')).toBeInTheDocument();
    expect(screen.getByText('Ejecutada')).toBeInTheDocument();
    expect(screen.getByText('1/1 ejecutadas')).toBeInTheDocument();
  });
});
