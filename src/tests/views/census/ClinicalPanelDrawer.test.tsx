import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  downloadHospitalizationDocument: vi.fn(),
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
    requestRayenHospitalizationDocument: (...args: unknown[]) =>
      mocks.downloadHospitalizationDocument(...args),
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

const renderDrawer = (bedId: string) =>
  render(
    <ClinicalPanelDrawer
      bedId={bedId}
      patientName="Paciente de prueba"
      clinicalEpisodeId="141121"
      onOpenHospitalizationReports={vi.fn()}
      onClose={vi.fn()}
    />
  );

describe('ClinicalPanelDrawer', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelResult);
    mocks.downloadHospitalizationDocument.mockReset();
    mocks.downloadHospitalizationDocument.mockResolvedValue({ ok: true, opened: true });
    mocks.navigate.mockReset();
    mocks.navigate.mockResolvedValue({ ok: true, reused: true });
    mocks.openDocument.mockReset();
    mocks.openDocument.mockResolvedValue({ ok: true, opened: true });
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it('isolates reading from a draggable census row without cancelling native text selection', async () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <div draggable onDragStart={onDragStart}>
        <ClinicalPanelDrawer
          bedId="R1"
          patientName="Paciente de prueba"
          clinicalEpisodeId="141121"
          onOpenHospitalizationReports={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );
    const text = await screen.findByText('Evolución médica estable.');
    const drawer = screen.getByRole('dialog');
    expect(container.contains(drawer)).toBe(false);
    expect(drawer.closest('[draggable="true"]')).toBeNull();
    expect(screen.getByTestId('clinical-panel-content')).toHaveClass('select-text', 'cursor-text');
    expect(fireEvent.mouseDown(text, { button: 0 })).toBe(true);
    fireEvent.dragStart(text);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('keeps refresh disabled while loading in the redesigned patient toolbar', async () => {
    let complete!: (value: typeof panelResult) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    renderDrawer('R1');
    const refresh = screen.getByRole('button', { name: 'Actualizar panel clínico' });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    complete(panelResult);
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    complete(panelResult);
    await waitFor(() => expect(refresh).toBeEnabled());
  });

  it('widens reading without refetching or changing the selected clinical section', async () => {
    renderDrawer('R1');
    await screen.findByText('Evolución médica estable.');
    const indications = screen.getByRole('button', { name: /Indicaciones/i });
    fireEvent.click(indications);
    expect(indications).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar panel de lectura' }));
    expect(screen.getByRole('dialog')).toHaveClass('w-[680px]');
    expect(indications).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reducir panel de lectura' }));
    expect(screen.getByRole('dialog')).toHaveClass('w-[460px]');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('separates handoffs, labels inactive medications, and renders care execution', async () => {
    renderDrawer('H1C2');

    await waitFor(() => expect(screen.getByText('Evolución médica estable.')).toBeInTheDocument());
    expect(mocks.request).toHaveBeenCalledWith('141121', undefined, expect.any(AbortSignal));
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

    renderDrawer('H1C2');

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

  it('opens the complete active hospitalization history from the profession row', async () => {
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141121"
        admissionDate="2026-07-13"
        censusDate="2026-07-18"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Evolución médica estable.');
    const printButton = screen.getByRole('button', {
      name: 'Imprimir en PDF el historial completo de la hospitalización de Paciente de prueba',
    });
    expect(printButton).toHaveClass('ml-auto');
    fireEvent.click(printButton);

    await waitFor(() =>
      expect(mocks.downloadHospitalizationDocument).toHaveBeenCalledWith({
        patientRun: '17.752.753-1',
        admissionDate: '2026-07-13',
        censusDate: '2026-07-18',
        clinicalEpisodeId: '141121',
        documentType: 'history',
      })
    );
    expect(mocks.success).toHaveBeenCalledWith(
      'Historial completo abierto',
      'Eloísa abrió el reporte oficial de Historial de Paciente de prueba para imprimirlo o guardarlo en PDF.'
    );
  });

  it('does not report success when the history tab could not be opened', async () => {
    mocks.downloadHospitalizationDocument.mockResolvedValue({ ok: true, opened: false });
    render(
      <ClinicalPanelDrawer
        bedId="H1C2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141121"
        admissionDate="2026-07-13"
        censusDate="2026-07-18"
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Evolución médica estable.');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Imprimir en PDF el historial completo de la hospitalización de Paciente de prueba',
      })
    );

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'No se pudo abrir el historial',
        'Eloísa respondió, pero el navegador no abrió el reporte de Historial.'
      )
    );
    expect(mocks.success).not.toHaveBeenCalled();
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
    expect(
      await screen.findByRole('dialog', { name: 'Documentos de Paciente de prueba' })
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Clasificación' })).toBeInTheDocument();
    const fileButton = screen.getByRole('button', { name: 'informe-prueba.pdf' });
    fireEvent.click(fileButton);
    await waitFor(() => expect(mocks.openDocument).toHaveBeenCalledWith('141121', 'id:doc-1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps an empty document manager available but visually faded without a badge', async () => {
    mocks.request.mockResolvedValue({ ...panelResult, documents: [] });
    renderDrawer('H1C2');

    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; sin archivos',
    });
    expect(documentsButton).not.toHaveClass('opacity-30');
    expect(documentsButton.querySelector('[aria-hidden="true"]')).toHaveClass('opacity-40');
    expect(documentsButton).not.toHaveTextContent(/\d/);
    expect(documentsButton).toBeEnabled();
    fireEvent.click(documentsButton);
    expect(
      await screen.findByText('No hay documentos visibles para este paciente.')
    ).toBeInTheDocument();
  });

  it('does not present an unavailable document query as an empty repository', async () => {
    mocks.request.mockResolvedValue({
      ...panelResult,
      documents: undefined,
      documentError: 'No se pudieron leer los documentos.',
    });
    renderDrawer('H1C2');
    const documentsButton = await screen.findByRole('button', {
      name: 'Abrir Gestor documental de Paciente de prueba; cantidad no disponible',
    });
    expect(documentsButton).not.toHaveClass('opacity-30');
    fireEvent.click(documentsButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron leer los documentos.'
    );
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
