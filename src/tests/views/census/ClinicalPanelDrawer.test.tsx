import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  navigate: vi.fn(),
  openDocument: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/rayen-import', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import')>();
  return {
    ...actual,
    requestClinicalPanel: (...args: unknown[]) => mocks.request(...args),
    requestRayenEncounterNavigation: (...args: unknown[]) => mocks.navigate(...args),
    requestPatientDocumentOpen: (...args: unknown[]) => mocks.openDocument(...args),
  };
});

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

import { ClinicalPanelDrawer } from '@/features/census/components/patient-row/ClinicalPanelDrawer';

const panelResult = {
  documents: [
    {
      id: 'id:doc-1',
      classification: 'Clínico',
      fileName: 'informe-prueba.pdf',
      name: 'Evaluación de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-16T10:00:00',
    },
    {
      id: 'id:doc-2',
      classification: 'Clínico',
      fileName: 'resultado-prueba.pdf',
      name: 'Resultado de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-17T10:00:00',
    },
    {
      id: 'id:doc-3',
      classification: 'Administrativo',
      fileName: 'formulario-prueba.pdf',
      name: 'Formulario de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-18T10:00:00',
    },
  ],
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
    mocks.openDocument.mockReset();
    mocks.openDocument.mockResolvedValue({ ok: true, opened: true });
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
    const reportsButton = screen.getByRole('button', {
      name: 'Abrir informes de hospitalización de Paciente de prueba',
    });
    expect(reportsButton).toHaveTextContent('Informes');
    fireEvent.click(reportsButton);

    expect(onOpenHospitalizationReports).toHaveBeenCalledOnce();
  });

  it('shows the active attachment count and opens the local patient document manager', async () => {
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

    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; 3 archivos',
    });
    expect(documentsButton).toHaveTextContent('3');
    fireEvent.click(documentsButton);
    expect(await screen.findByRole('dialog', { name: 'Documentos de Paciente de prueba' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Clasificación' })).toBeInTheDocument();
    const fileButton = screen.getByRole('button', { name: 'informe-prueba.pdf' });
    fireEvent.click(fileButton);
    await waitFor(() => expect(mocks.openDocument).toHaveBeenCalledWith('141121', 'id:doc-1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps an empty document manager available but visually faded without a badge', async () => {
    mocks.request.mockResolvedValue({ ...panelResult, documents: [] });
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; sin archivos',
    });
    expect(documentsButton).toHaveClass('opacity-30');
    expect(documentsButton).not.toHaveTextContent(/\d/);
    expect(documentsButton).toBeEnabled();
    fireEvent.click(documentsButton);
    expect(await screen.findByText('No hay documentos visibles para este paciente.')).toBeInTheDocument();
  });

  it('does not present an unavailable document query as an empty repository', async () => {
    mocks.request.mockResolvedValue({
      ...panelResult,
      documents: undefined,
      documentError: 'No se pudieron leer los documentos.',
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
    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; cantidad no disponible',
    });
    expect(documentsButton).not.toHaveClass('opacity-30');
    fireEvent.click(documentsButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer los documentos.');
  });

  it('closes only the document dialog when Escape is pressed inside it', async () => {
    const closeDrawer = vi.fn();
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141121"
        onOpenHospitalizationReports={vi.fn()}
        onClose={closeDrawer}
      />
    );
    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; 3 archivos',
    });
    fireEvent.click(documentsButton);
    const dialog = await screen.findByRole('dialog', { name: 'Documentos de Paciente de prueba' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Documentos de Paciente de prueba' })).toBeNull();
    expect(closeDrawer).not.toHaveBeenCalled();
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
