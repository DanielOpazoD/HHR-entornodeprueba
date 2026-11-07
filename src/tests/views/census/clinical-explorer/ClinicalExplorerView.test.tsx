import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), print: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});
vi.mock(
  '@/features/census/components/clinical-explorer/clinicalExplorerPrint',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('@/features/census/components/clinical-explorer/clinicalExplorerPrint')
      >();
    return { ...actual, printHtmlDocument: (html: string) => mocks.print(html) };
  }
);
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

import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
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

const Harness = ({ list = patients }: { list?: typeof patients }) => {
  const selection = useClinicalExplorerSelection(DATE);
  return (
    <>
      <button type="button" data-testid="clinical-panel-trigger-R1">
        Ficha R1
      </button>
      {selection ? (
        <>
          <ClinicalExplorerBar bedId={selection.bedId} />
          <ClinicalExplorerView censusDate={DATE} bedId={selection.bedId} patients={list} />
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T04:30:00Z'));
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelWithActiveIndication);
  });
  afterEach(() => {
    act(() => {
      closeClinicalExplorer();
      setSessionGeneration(null);
    });
    vi.useRealTimers();
  });

  it('shows only a back button above the patient header, and reads Ficha Médico once', async () => {
    open();
    expect(screen.queryByText(/Censo del miércoles/)).toBeNull();
    expect(screen.queryByText('Experimental')).toBeNull();
    expect(screen.getByRole('button', { name: 'Volver al censo' })).toBeVisible();
    const header = screen.getByTestId('clinical-explorer-patient');
    expect(header).toHaveTextContent('PRIMERA SINTÉTICA');
    expect(header).toHaveTextContent('Ingreso 01-11-2026 · 3 d');
    // The episode number and the previous/next buttons are gone: the side list is enough.
    expect(header).not.toHaveTextContent('ep-r1');
    expect(header).not.toHaveTextContent('1 de 2');
    expect(screen.queryByRole('button', { name: 'Paciente siguiente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paciente anterior' })).toBeNull();
    expect(await screen.findByText('Evolución médica estable.')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toBe('ep-r1');
  });

  it('prioritizes evolutions and vitals, followed by laboratory, imaging and indications', async () => {
    open();
    await screen.findByText('Evolución médica estable.');
    const areas = ['Evoluciones', 'Signos vitales', 'Laboratorio', 'Imágenes', 'Indicaciones'];
    const regions = areas.map(name => screen.getByRole('region', { name }));
    regions.slice(1).forEach((region, index) => {
      expect(
        regions[index].compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Vista conjunta',
      ...areas,
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Signos vitales' }));
    expect(screen.getByRole('region', { name: 'Signos vitales' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Evoluciones' })).toBeNull();
  });

  it('lists patients in bed order and keeps the area when choosing another patient', async () => {
    open();
    const list = screen.getByRole('list', { name: 'Lista de pacientes' });
    const items = within(list).getAllByRole('button');
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('R1'),
      expect.stringContaining('H1C1'),
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    // Bed, name and RUT only: neither days in hospital nor the episode number.
    expect(items[0]).not.toHaveTextContent('3 d');
    expect(items[0]).not.toHaveTextContent('ep-r1');
    fireEvent.click(screen.getByRole('tab', { name: 'Indicaciones' }));
    fireEvent.click(items[1]);
    expect(screen.getByTestId('clinical-explorer-patient')).toHaveTextContent('SEGUNDO SINTÉTICO');
    expect(screen.getByRole('tab', { name: 'Indicaciones' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('ep-h1c1', undefined, expect.anything())
    );
    expect(within(list).getAllByRole('button')[1]).toHaveAttribute('aria-current', 'true');
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

  it('shows only the Rapa Nui calendar day, independently of UTC and the census date', async () => {
    mocks.request.mockResolvedValue(panelWithOlderActiveTreatment);
    open();
    const card = await screen.findByRole('region', { name: 'Indicaciones' });
    await within(card).findByText('Sin indicaciones vigentes para esta fecha.');
    expect(within(card).getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    expect(card).toHaveTextContent('0 vigentes');
    expect(within(card).queryByText('AMOXICILINA 500 mg')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Mostrar 1 suspendida' }));
    expect(within(card).getByText('CEFTRIAXONA 2 g')).toBeVisible();
    expect(within(card).queryByText('OMEPRAZOL 20 mg')).toBeNull();
    fireEvent.change(within(card).getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    expect(within(card).getByText('AMOXICILINA 500 mg')).toBeVisible();
    expect(card).toHaveTextContent('1 vigentes');
    expect(within(card).queryByText('CEFTRIAXONA 2 g')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Hoy' }));
    expect(within(card).getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    expect(within(card).queryByText('CEFTRIAXONA 2 g')).toBeNull();
    expect(within(card).queryByText('AMOXICILINA 500 mg')).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected date across laboratory and imaging for the same patient', async () => {
    mocks.request.mockResolvedValue(panelWithOlderActiveTreatment);
    open();
    await screen.findByText('Sin indicaciones vigentes para esta fecha.');
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    for (const area of ['Laboratorio', 'Imágenes', 'Evoluciones', 'Signos vitales']) {
      fireEvent.click(screen.getByRole('tab', { name: area }));
      fireEvent.click(screen.getByRole('tab', { name: 'Indicaciones' }));
      expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-11');
      expect(await screen.findByText('AMOXICILINA 500 mg')).toBeVisible();
    }
  });

  it('prints from the patient header the same day chosen in the indications area', async () => {
    mocks.request.mockResolvedValue(panelWithOlderActiveTreatment);
    mocks.print.mockResolvedValue(undefined);
    open();
    await screen.findByText('Sin indicaciones vigentes para esta fecha.');
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    const header = screen.getByTestId('clinical-explorer-patient');
    fireEvent.click(within(header).getByRole('button', { name: 'Imprimir indicaciones' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1));
    expect(mocks.print.mock.calls[0][0]).toContain('Indicaciones médicas del 11-07-2026');
    expect(mocks.print.mock.calls[0][0]).toContain('AMOXICILINA 500 mg');
    expect(within(header).getByRole('button', { name: 'Receta' })).toBeVisible();
  });

  it('leaves an empty selected day empty instead of substituting an older treatment', async () => {
    vi.setSystemTime(new Date('2026-07-14T08:00:00Z'));
    open();
    const card = await screen.findByRole('region', { name: 'Indicaciones' });
    await within(card).findByText('Sin indicaciones registradas para esta fecha.');
    expect(within(card).getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-14');
    expect(card).toHaveTextContent('0 vigentes');
    expect(within(card).queryByText('AMOXICILINA 500 mg')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Indicaciones' }));
    expect(within(card).queryByText('AMOXICILINA 500 mg')).toBeNull();
  });

  it('advances today on returning after midnight while keeping an explicitly selected day', async () => {
    open();
    await screen.findByText('AMOXICILINA 500 mg');
    vi.setSystemTime(new Date('2026-07-14T06:00:00Z'));
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-14');
    expect(screen.queryByText('AMOXICILINA 500 mg')).toBeNull();
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-13' },
    });
    expect(screen.getByText('AMOXICILINA 500 mg')).toBeVisible();
    vi.setSystemTime(new Date('2026-07-15T06:00:00Z'));
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-15');
  });

  it('resets the chosen day and suspended visibility for another patient or session', async () => {
    open();
    await screen.findByText('AMOXICILINA 500 mg');
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    await screen.findByText('AMOXICILINA 500 mg');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 1 suspendida' }));
    expect(screen.getByText('CEFTRIAXONA 2 g')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    act(() => setSessionGeneration('explorer-indications-new-session'));
    expect(screen.getByText('Censo visible')).toBeVisible();
    act(() => openClinicalExplorer({ censusDate: DATE, bedId: 'H1C1' }));
    await screen.findByText('AMOXICILINA 500 mg');
    expect(screen.queryByText('CEFTRIAXONA 2 g')).toBeNull();
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
  });

  it('resets the date when a new episode occupies the same bed', async () => {
    const view = open();
    await screen.findByText('AMOXICILINA 500 mg');
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    view.rerender(
      <Harness
        list={patients.map(patient => ({ ...patient, episodeId: `${patient.episodeId}-new` }))}
      />
    );
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    await screen.findByText('AMOXICILINA 500 mg');
    expect(mocks.request).toHaveBeenLastCalledWith('ep-r1-new', undefined, expect.anything());
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
    fireEvent.click(screen.getByRole('button', { name: 'Exámenes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Solicitud de exámenes' });
    expect(dialog).toHaveTextContent('PRIMERA SINTÉTICA');
    // Opened for this patient, with the census patients it may add as further orders.
    // Orders are keyed by patient and episode: they follow a move and never pass to another person.
    expect(within(dialog).getByTestId('exam-request-scope')).toHaveTextContent(
      '123456785:ep-r1 de 123456785:ep-r1,58448656:ep-h1c1'
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Censo visible')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Radiología' }));
    expect(await screen.findByRole('dialog', { name: 'Orden de imágenes' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Informes locales' }));
    expect(await screen.findByRole('dialog', { name: 'Documentos clínicos' })).toBeVisible();
  });

  it('keeps the laboratory request open when its patient moves to another bed', async () => {
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Exámenes' }));
    expect(await screen.findByRole('dialog', { name: 'Solicitud de exámenes' })).toHaveTextContent(
      'PRIMERA SINTÉTICA'
    );
    // Same patient and episode, now in another bed: R1, still on screen, is empty.
    view.rerender(<Harness list={[{ ...patients[0], bedId: 'R2' }, patients[1]]} />);
    expect(screen.getByText(/Este paciente ya no está en el censo del día/)).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Solicitud de exámenes' })).toHaveTextContent(
      'PRIMERA SINTÉTICA'
    );
    // Once the patient leaves the census, the request leaves with them.
    view.rerender(<Harness list={[patients[1]]} />);
    expect(screen.queryByRole('dialog', { name: 'Solicitud de exámenes' })).toBeNull();
    // And it does not reopen by itself if the patient comes back.
    view.rerender(<Harness />);
    expect(screen.queryByRole('dialog', { name: 'Solicitud de exámenes' })).toBeNull();
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
