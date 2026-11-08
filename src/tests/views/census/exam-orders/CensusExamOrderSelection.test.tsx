import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType, type BedDefinition } from '@/features/census/contracts/censusBedContracts';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';
import { CensusExamOrderLauncher } from '@/features/census/components/exam-orders/CensusExamOrderLauncher';
import {
  CensusExamOrderDateContext,
  CensusExamRequestCandidatesContext,
} from '@/features/census/components/exam-orders/examOrderContext';
import { clearExamOrderSelection } from '@/features/census/components/exam-orders/examOrderSelectionStore';
import { listCensusExamRequestCandidates } from '@/features/census/controllers/censusExamRequestController';

const printMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/controllers/examRequestPrintController', () => ({
  runExamRequestPrint: printMock,
}));
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));
vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));
vi.mock('@/features/census/components/patient-row/SpecialtyChip', () => ({
  SpecialtyChip: () => null,
}));

const CENSUS_DATE = '2026-11-08';
const visibleBeds: BedDefinition[] = ['R1', 'R2', 'R3'].map(id => ({
  id,
  name: id,
  type: BedType.UTI,
  isCuna: false,
}));
// Synthetic people; the third has a passport and no episode yet.
const beds = {
  R1: DataFactory.createMockPatient('R1', {
    patientName: 'ANA SINTETICA',
    rut: '11.111.111-1',
    clinicalEpisodeId: 'ep-ana',
  }),
  R2: DataFactory.createMockPatient('R2', {
    patientName: 'BRUNO SINTETICO',
    rut: '22.222.222-2',
    clinicalEpisodeId: 'ep-bruno',
  }),
  R3: DataFactory.createMockPatient('R3', {
    patientName: 'CARLA SINTETICA',
    rut: 'P123456',
    documentType: 'Pasaporte',
    clinicalEpisodeId: undefined,
    admissionDate: '2026-11-07',
    admissionTime: '09:30',
  }),
};

const renderCensus = ({ canPrepareOrders = true } = {}) => {
  const candidates = listCensusExamRequestCandidates({ visibleBeds, beds });
  const date = canPrepareOrders ? CENSUS_DATE : null;
  return render(
    <UIProvider>
      <CensusExamRequestCandidatesContext.Provider value={candidates}>
        <CensusExamOrderDateContext.Provider value={date}>
          <table>
            <tbody>
              {visibleBeds.map(bed => (
                <tr key={bed.id} data-testid={`row-${bed.id}`}>
                  <PatientIdentityCell
                    data={beds[bed.id as keyof typeof beds]}
                    currentDateString={CENSUS_DATE}
                    hasRutError={false}
                    onNameChange={() => vi.fn()}
                    onOpenDemographics={vi.fn()}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          <p>Fuera del censo</p>
        </CensusExamOrderDateContext.Provider>
      </CensusExamRequestCandidatesContext.Provider>
      {date && <CensusExamOrderLauncher censusDate={date} candidates={candidates} />}
    </UIProvider>
  );
};

const BED_OF: Record<string, string> = {
  'ANA SINTETICA': 'R1',
  'BRUNO SINTETICO': 'R2',
  'CARLA SINTETICA': 'R3',
};
const nameBox = (name: string): HTMLElement =>
  within(screen.getByTestId(`row-${BED_OF[name]}`))
    .getByText(name)
    .closest('.census-identity-name') as HTMLElement;
/** Returns whether the browser would go on to select text. */
const shiftClick = (name: string): boolean =>
  fireEvent.mouseDown(nameBox(name), { shiftKey: true, button: 0 });
const isChosen = (name: string): boolean => nameBox(name).hasAttribute('data-exam-order-selected');
const orderButton = () => screen.queryByRole('button', { name: /Orden de exámenes/ });

describe('census laboratory orders for several patients', () => {
  // The request loads on demand; load it once so the tests wait for people, not for the module.
  beforeAll(async () => {
    await import('@/components/modals/ExamRequestModal');
  });

  afterEach(() => {
    cleanup();
    act(() => clearExamOrderSelection());
    printMock.mockReset();
  });

  it('chooses patients with Shift + click, shows them on the rows and opens a tab each', async () => {
    renderCensus();
    expect(orderButton()).not.toBeInTheDocument();

    // The browser's own Shift selection of text is held off.
    expect(shiftClick('CARLA SINTETICA')).toBe(false);
    expect(shiftClick('ANA SINTETICA')).toBe(false);
    expect(isChosen('ANA SINTETICA')).toBe(true);
    expect(isChosen('CARLA SINTETICA')).toBe(true);
    expect(isChosen('BRUNO SINTETICO')).toBe(false);
    expect(
      within(screen.getByRole('region', { name: /orden de exámenes/ })).getByText('2 pacientes')
    ).toBeInTheDocument();

    fireEvent.click(orderButton()!);

    const tabs = within(
      await screen.findByRole('tablist', { name: 'Pacientes de la solicitud' })
    ).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual([
      expect.stringContaining('CARLA SINTETICA'),
      expect.stringContaining('ANA SINTETICA'),
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // Opening the request uses the choice up.
    expect(isChosen('ANA SINTETICA')).toBe(false);
    expect(orderButton()).not.toBeInTheDocument();
  });

  it('keeps a plain click as it was, and clears the choice with Escape or a click elsewhere', () => {
    renderCensus();

    // A plain click chooses nothing and leaves text selection to the browser.
    expect(fireEvent.mouseDown(nameBox('ANA SINTETICA'), { button: 0 })).toBe(true);
    expect(isChosen('ANA SINTETICA')).toBe(false);

    shiftClick('ANA SINTETICA');
    shiftClick('BRUNO SINTETICO');
    // Shift + click again leaves that one out.
    shiftClick('BRUNO SINTETICO');
    expect(isChosen('BRUNO SINTETICO')).toBe(false);
    expect(screen.getByText('1 paciente')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isChosen('ANA SINTETICA')).toBe(false);
    expect(orderButton()).not.toBeInTheDocument();

    shiftClick('ANA SINTETICA');
    fireEvent.mouseDown(screen.getByText('Fuera del censo'));
    expect(isChosen('ANA SINTETICA')).toBe(false);
    expect(orderButton()).not.toBeInTheDocument();

    shiftClick('ANA SINTETICA');
    fireEvent.mouseDown(nameBox('BRUNO SINTETICO'), { button: 0 });
    expect(isChosen('ANA SINTETICA')).toBe(false);
  });

  it('offers no choice where the census cannot prepare orders', () => {
    renderCensus({ canPrepareOrders: false });

    expect(shiftClick('ANA SINTETICA')).toBe(true);
    expect(isChosen('ANA SINTETICA')).toBe(false);
    expect(orderButton()).not.toBeInTheDocument();
  });

  it('keeps each tab apart and prints one page per patient with only that patient', async () => {
    renderCensus();
    shiftClick('ANA SINTETICA');
    shiftClick('BRUNO SINTETICO');
    shiftClick('CARLA SINTETICA');
    fireEvent.click(orderButton()!);
    const tablist = await screen.findByRole('tablist', { name: 'Pacientes de la solicitud' });
    const tab = (name: string) => within(tablist).getByRole('tab', { name: new RegExp(name) });
    // The form on screen; the others stay hidden until printed.
    const activeForm = () =>
      screen.getAllByTestId('exam-request-form').find(form => !form.classList.contains('hidden'))!;

    const plan = [
      { name: 'ANA SINTETICA', exam: 'HEMOGRAMA', otros: 'Ferritina', medico: 'Dra. Uno' },
      { name: 'BRUNO SINTETICO', exam: 'TROPONINA', otros: 'Procalcitonina', medico: 'Dr. Dos' },
      { name: 'CARLA SINTETICA', exam: 'UROCULTIVO', otros: '', medico: 'Dra. Tres' },
    ];
    for (const { name, exam, otros, medico } of plan) {
      fireEvent.click(tab(name));
      fireEvent.click(within(activeForm()).getByRole('checkbox', { name: exam }));
      fireEvent.change(within(activeForm()).getByRole('textbox', { name: 'OTROS' }), {
        target: { value: otros },
      });
      fireEvent.change(within(activeForm()).getByRole('textbox', { name: 'MEDICO TRATANTE' }), {
        target: { value: medico },
      });
    }

    // Back on the first tab, its own marks and text are still there.
    fireEvent.click(tab('ANA SINTETICA'));
    expect(within(activeForm()).getByRole('checkbox', { name: 'HEMOGRAMA' })).toBeChecked();
    expect(within(activeForm()).getByRole('checkbox', { name: 'TROPONINA' })).not.toBeChecked();
    expect(within(activeForm()).getByRole('textbox', { name: 'OTROS' })).toHaveValue('Ferritina');
    expect(tab('BRUNO SINTETICO')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir 3 órdenes' }));
    expect(printMock).toHaveBeenCalledTimes(1);

    // One page per patient, in the order chosen, each with its identity and nothing of the others.
    const pages = screen.getAllByTestId('exam-request-form');
    expect(pages).toHaveLength(3);
    pages.forEach((page, index) => {
      const own = plan[index]!;
      expect(page.style.breakAfter).toBe(index < 2 ? 'page' : '');
      expect(within(page).getByText(own.name)).toBeInTheDocument();
      expect(within(page).getByRole('checkbox', { name: own.exam })).toBeChecked();
      expect(within(page).getByTestId('exam-request-print-otros')).toHaveTextContent(own.otros);
      expect(within(page).getByTestId('exam-request-print-medicoTratante')).toHaveTextContent(
        own.medico
      );
      plan
        .filter(other => other !== own)
        .forEach(other => {
          expect(within(page).queryByText(other.name)).not.toBeInTheDocument();
          expect(within(page).getByRole('checkbox', { name: other.exam })).not.toBeChecked();
          expect(page).not.toHaveTextContent(other.medico);
        });
    });
    expect(within(pages[0]!).getByText('11.111.111-1')).toBeInTheDocument();
    expect(within(pages[2]!).getByText('P123456')).toBeInTheDocument();
  });
});
