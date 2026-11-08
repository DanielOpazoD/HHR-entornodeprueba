import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType, type BedDefinition } from '@/features/census/contracts/censusBedContracts';
import { PatientRowModals } from '@/features/census/components/patient-row/PatientRowModals';
import { CensusExamRequestCandidatesContext } from '@/features/census/components/exam-orders/examOrderContext';
import { listCensusExamRequestCandidates } from '@/features/census/controllers/censusExamRequestController';

vi.mock('@/hooks/controllers/examRequestPrintController', () => ({
  runExamRequestPrint: vi.fn(),
}));
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const visibleBeds: BedDefinition[] = ['R1', 'R2', 'R3'].map(id => ({
  id,
  name: id,
  type: BedType.UTI,
  isCuna: false,
}));
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
  // An empty bed offers nobody to add.
  R3: DataFactory.createMockPatient('R3', { patientName: '', rut: '' }),
};

const renderRowRequest = (withCensus: boolean) =>
  render(
    <CensusExamRequestCandidatesContext.Provider
      value={withCensus ? listCensusExamRequestCandidates({ visibleBeds, beds }) : null}
    >
      <PatientRowModals
        bedId="R1"
        data={beds.R1}
        currentDateString="2026-11-08"
        isSubRow={false}
        showDemographics={false}
        showClinicalDocuments={false}
        canOpenClinicalDocuments={false}
        showExamRequest
        canOpenExamRequest
        showImagingRequest={false}
        canOpenImagingRequest
        showHistory={false}
        canOpenHistory
        onCloseDemographics={vi.fn()}
        onCloseClinicalDocuments={vi.fn()}
        onCloseExamRequest={vi.fn()}
        onCloseImagingRequest={vi.fn()}
        onCloseHistory={vi.fn()}
        onSaveDemographics={vi.fn()}
        onSaveCribDemographics={vi.fn()}
        onRevertEmptyDemographics={vi.fn()}
      />
    </CensusExamRequestCandidatesContext.Provider>
  );

describe('laboratory request opened from one census row', () => {
  beforeAll(async () => {
    await import('@/components/modals/ExamRequestModal');
  });

  it('adds other census patients as tabs and removes them again', async () => {
    renderRowRequest(true);
    const tablist = await screen.findByRole('tablist', { name: 'Pacientes de la solicitud' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(1);
    expect(within(tablist).getByRole('tab')).toHaveTextContent('ANA SINTETICA');
    // The only patient cannot be removed.
    expect(screen.queryByRole('button', { name: /^Quitar a / })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Paciente/ }));
    const picker = screen.getByRole('group', { name: 'Pacientes del censo para esta solicitud' });
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(within(picker).getByRole('checkbox', { name: /BRUNO SINTETICO/ }));

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveTextContent('BRUNO SINTETICO');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByTestId('exam-request-form')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Imprimir 2 órdenes' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar a BRUNO SINTETICO de la solicitud' })
    );
    expect(within(tablist).getAllByRole('tab')).toHaveLength(1);
    expect(within(tablist).getByRole('tab')).toHaveTextContent('ANA SINTETICA');
    expect(screen.getAllByTestId('exam-request-form')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
  });

  it('stays a single-patient request outside the census', async () => {
    renderRowRequest(false);
    expect(await screen.findByTestId('exam-request-form')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
  });
});
