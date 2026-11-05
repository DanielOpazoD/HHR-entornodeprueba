import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});
vi.mock('@/components/modals/ExamRequestModal', () => ({
  ExamRequestModal: ({
    patient,
    candidates,
    patientKey,
  }: {
    patient: { patientName: string };
    candidates?: Array<{ key: string }>;
    patientKey?: string;
  }) => (
    <div role="dialog" aria-label="Solicitud de exámenes">
      {patient.patientName}
      <span data-testid="exam-request-scope">
        {patientKey} de {candidates?.map(candidate => candidate.key).join(',')}
      </span>
    </div>
  ),
}));
vi.mock('@/components/modals/ImagingRequestDialog', () => ({
  ImagingRequestDialog: () => <div role="dialog" aria-label="Orden de imágenes" />,
}));
vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: () => <div role="dialog" aria-label="Documentos clínicos" />,
}));
// MMRAD answers with no studies here; the imaging card is covered by its own test.
vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: ({ rut }: { rut: string }) => Promise.resolve({ rut, examenes: [] }),
    searchMMRADCheckDigitExams: ({ rut }: { rut: string }) =>
      Promise.resolve({ rut, examenes: [] }),
  };
});
vi.mock('@/components/radiology/useDicomReviewCache', () => ({
  useDicomReviewCache: () => undefined,
}));
// Syslab is out of reach in this test: the laboratory card shows a quiet failure.
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: () => ({
    state: 'unavailable',
    message: 'Syslab no está disponible.',
    isOpening: false,
    isAwaitingLogin: false,
    refresh: vi.fn(),
    openLogin: vi.fn(),
  }),
}));

import { panelResult } from '../clinicalPanelDrawer.fixture';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerBar } from '@/features/census/components/clinical-explorer/ClinicalExplorerBar';
import { ClinicalExplorerView } from '@/features/census/components/clinical-explorer/ClinicalExplorerView';
import {
  closeClinicalExplorer,
  openClinicalExplorer,
  useClinicalExplorerSelection,
} from '@/features/census/components/clinical-explorer/clinicalExplorerStore';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

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

// Two recent days with suspended orders only, and an older day with the active treatment.
const pharma = panelResult.events[0].patientPharmaIndicationResume;
const panelWithOlderActiveTreatment = {
  ...panelResult,
  carePlan: {
    ...panelResult.carePlan,
    medicationStates: [
      { id: 7, suspended: true, archived: false },
      { id: 9, suspended: true, archived: false },
      { id: 8, suspended: false, archived: false, finalized: false },
    ],
  },
  events: [
    {
      ...panelResult.events[0],
      patientPharmaIndicationResume: [
        { ...pharma[0], PUBLISH_DATETIME: '2026-07-13T08:00:00' },
        {
          ...pharma[0],
          MRE_ID: 9,
          DESCRIPTOR: 'OMEPRAZOL 20 mg',
          PUBLISH_DATETIME: '2026-07-12T08:00:00',
        },
        { ...pharma[1], FINALIZED: false, PUBLISH_DATETIME: '2026-07-11T08:30:00' },
      ],
    },
  ],
};

const Harness = () => {
  const selection = useClinicalExplorerSelection(DATE);
  return (
    <>
      <button type="button" data-testid="clinical-panel-trigger-R1">
        Ficha R1
      </button>
      {selection ? (
        <>
          <ClinicalExplorerBar censusDate={DATE} bedId={selection.bedId} />
          <ClinicalExplorerView censusDate={DATE} bedId={selection.bedId} patients={patients} />
        </>
      ) : (
        <p>Censo visible</p>
      )}
    </>
  );
};

const open = (bedId = 'R1') => {
  act(() => openClinicalExplorer({ censusDate: DATE, bedId }));
  const { wrapper } = createQueryClientTestWrapper();
  return render(<Harness />, { wrapper });
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
    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('ep-h1c1', undefined, expect.anything())
    );
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

  it('keeps an older active treatment visible in the combined view behind days of suspended orders', async () => {
    mocks.request.mockResolvedValue(panelWithOlderActiveTreatment);
    open();
    const card = await screen.findByRole('region', { name: 'Indicaciones' });
    await within(card).findByText('AMOXICILINA 500 mg');
    expect(card).toHaveTextContent('1 vigentes');
    expect(within(card).queryByText('Sin indicaciones vigentes en Ficha Médico.')).toBeNull();
    // The compact view holds the active day only; the suspended days wait in the full area.
    expect(within(card).queryByRole('button', { name: /Mostrar/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Ver todas ›' }));
    const full = screen.getByRole('region', { name: 'Indicaciones' });
    fireEvent.click(within(full).getByRole('button', { name: 'Mostrar 2 suspendidas' }));
    expect(within(full).getByText('AMOXICILINA 500 mg')).toBeVisible();
    expect(within(full).getByText('OMEPRAZOL 20 mg')).toBeVisible();
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

  it('returns the focus to the row that opened it, so the keyboard user is not lost', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Volver al censo' }));
    await waitFor(() => expect(screen.getByTestId('clinical-panel-trigger-R1')).toHaveFocus());
  });

  it('opens the exam request for this patient and lets the dialog own Escape', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar exámenes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Solicitud de exámenes' });
    expect(dialog).toHaveTextContent('PRIMERA SINTÉTICA');
    // Opened for this patient, with the census patients it may add as further orders.
    // Orders are keyed by bed and episode, so a new occupant of a bed never inherits one.
    expect(within(dialog).getByTestId('exam-request-scope')).toHaveTextContent(
      'R1:ep-r1 de R1:ep-r1,H1C1:ep-h1c1'
    );
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
    const evolutions = await screen.findByRole('region', { name: 'Evoluciones' });
    const alert = await within(evolutions).findByRole('alert');
    expect(alert).toHaveTextContent('Eloísa sin sesión');
    expect(screen.queryByText('Sin evoluciones en Ficha Médico.')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Evolución médica estable.')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('tells when the selected patient left the census and keeps the list usable', () => {
    open('H6C2');
    expect(screen.getByText(/ya no está en el censo del día/)).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Lista de pacientes' })).getAllByRole('button')[1]
    );
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('SEGUNDO SINTÉTICO');
  });
});
