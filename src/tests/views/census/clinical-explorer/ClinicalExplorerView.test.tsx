import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});
vi.mock('@/components/modals/ExamRequestModal', () => ({
  ExamRequestModal: ({ patient }: { patient: { patientName: string } }) => (
    <div role="dialog" aria-label="Solicitud de exámenes">
      {patient.patientName}
    </div>
  ),
}));
vi.mock('@/components/modals/ImagingRequestDialog', () => ({
  ImagingRequestDialog: () => <div role="dialog" aria-label="Orden de imágenes" />,
}));
vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: () => <div role="dialog" aria-label="Documentos clínicos" />,
}));

import { panelResult } from '../clinicalPanelDrawer.fixture';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerView } from '@/features/census/components/clinical-explorer/ClinicalExplorerView';
import {
  closeClinicalExplorer,
  openClinicalExplorer,
  useClinicalExplorerSelection,
} from '@/features/census/components/clinical-explorer/clinicalExplorerStore';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';

const DATE = '2026-11-04';
const patients = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PRIMERA SINTÉTICA',
      rut: '12.345.678-5',
      clinicalEpisodeId: 'ep-r1',
      admissionDate: '2026-11-01',
      pathology: 'Neumonía sintética',
    }),
    H1C1: DataFactory.createMockPatient('H1C1', {
      patientName: 'SEGUNDO SINTÉTICO',
      rut: '5.844.865-6',
      clinicalEpisodeId: 'ep-h1c1',
    }),
  },
});

// One active and one suspended indication, a medical note and two shift handoffs.
const panelWithActiveIndication = {
  ...panelResult,
  carePlan: {
    ...panelResult.carePlan,
    medicationStates: [
      { id: 7, suspended: true, archived: false },
      { id: 8, suspended: false, archived: false, finalized: false },
    ],
  },
  events: [
    {
      ...panelResult.events[0],
      patientPharmaIndicationResume: [
        panelResult.events[0].patientPharmaIndicationResume[0],
        { ...panelResult.events[0].patientPharmaIndicationResume[1], FINALIZED: false },
      ],
    },
  ],
};

const Harness = () => {
  const selection = useClinicalExplorerSelection(DATE);
  return selection ? (
    <ClinicalExplorerView
      censusDate={DATE}
      bedId={selection.bedId}
      patients={patients}
      marginStyle={{}}
    />
  ) : (
    <p>Censo visible</p>
  );
};

const open = (bedId = 'R1') => {
  act(() => openClinicalExplorer({ censusDate: DATE, bedId }));
  return render(<Harness />);
};

describe('ClinicalExplorerView', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelWithActiveIndication);
  });
  afterEach(() => act(() => closeClinicalExplorer()));

  it('shows the census day, the patient with its episode, and reads Ficha Médico once', async () => {
    open();
    expect(screen.getByText('Censo del miércoles, 4 de noviembre de 2026')).toBeVisible();
    const header = screen.getByTestId('clinical-explorer-patient');
    expect(header).toHaveTextContent('PRIMERA SINTÉTICA');
    expect(header).toHaveTextContent('Ep. ep-r1');
    expect(header).toHaveTextContent('Ingreso 01-11-2026 · 3 d');
    expect(header).toHaveTextContent('1 de 2');
    expect(await screen.findByText('Evolución médica estable.')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toBe('ep-r1');
  });

  it('lists patients in bed order and keeps the area when moving to the next patient', async () => {
    open();
    const list = screen.getByRole('list', { name: 'Lista de pacientes' });
    const items = within(list).getAllByRole('button');
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('R1'),
      expect.stringContaining('H1C1'),
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Indicaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paciente siguiente' }));
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('SEGUNDO SINTÉTICO');
    expect(screen.getByRole('tab', { name: 'Indicaciones' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith('ep-h1c1', undefined, expect.anything()));
    expect(screen.getByRole('button', { name: 'Paciente siguiente' })).toBeDisabled();
  });

  it('hides suspended indications until asked and shows no kind labels', async () => {
    open();
    const card = await screen.findByRole('region', { name: 'Indicaciones' });
    await within(card).findByText('AMOXICILINA 500 mg');
    expect(within(card).queryByText('CEFTRIAXONA 2 g')).toBeNull();
    expect(within(card).queryByText('Fármaco')).toBeNull();
    expect(card).toHaveTextContent('1 vigentes');
    fireEvent.click(within(card).getByRole('button', { name: 'Mostrar 1 suspendida' }));
    expect(within(card).getByText('CEFTRIAXONA 2 g')).toBeVisible();
  });

  it('filters evolutions by profession and opens all of them from the combined view', async () => {
    open();
    await screen.findByText('Evolución médica estable.');
    fireEvent.click(screen.getByRole('button', { name: 'Enfermería (1)' }));
    expect(screen.getByText('Entrega enfermería: sin novedades.')).toBeVisible();
    expect(screen.queryByText('Evolución médica estable.')).toBeNull();
  });

  it('returns to the census with the button, with Escape, and with the arrows changes patient', () => {
    open();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('SEGUNDO SINTÉTICO');
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('PRIMERA SINTÉTICA');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Censo visible')).toBeVisible();
    act(() => openClinicalExplorer({ censusDate: DATE, bedId: 'H1C1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver al censo' }));
    expect(screen.getByText('Censo visible')).toBeVisible();
  });

  it('opens the exam request for this patient and lets the dialog own Escape', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar exámenes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Solicitud de exámenes' });
    expect(dialog).toHaveTextContent('PRIMERA SINTÉTICA');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Censo visible')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Orden de radiología' }));
    expect(await screen.findByRole('dialog', { name: 'Orden de imágenes' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Documentos clínicos' }));
    expect(await screen.findByRole('dialog', { name: 'Documentos clínicos' })).toBeVisible();
  });

  it('shows a failed read as a failure with retry, never as an empty record', async () => {
    mocks.request.mockResolvedValueOnce({ events: [], error: 'Eloísa sin sesión' });
    open();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('Eloísa sin sesión');
    expect(screen.queryByText('Sin evoluciones en Ficha Médico.')).toBeNull();
    fireEvent.click(within(alerts[0]).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Evolución médica estable.')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('tells when the selected patient left the census and keeps the list usable', () => {
    open('H6C2');
    expect(screen.getByText(/ya no está en el censo del día/)).toBeVisible();
    fireEvent.click(within(screen.getByRole('list', { name: 'Lista de pacientes' })).getAllByRole('button')[1]);
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('SEGUNDO SINTÉTICO');
  });
});
