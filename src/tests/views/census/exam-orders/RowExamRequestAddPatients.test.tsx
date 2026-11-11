import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/features/census/contracts/censusBedContracts';
import { type BedDefinition } from '@/types/domain/beds';
import { PatientRowModals } from '@/features/census/components/patient-row/PatientRowModals';
import { CensusExamOrderLauncher } from '@/features/census/components/exam-orders/CensusExamOrderLauncher';
import {
  CensusExamOrderDateContext,
  CensusExamRequestCandidatesContext,
} from '@/features/census/components/exam-orders/examOrderContext';
import { closeExamOrderRequest } from '@/features/census/components/exam-orders/examOrderSelectionStore';
import { listCensusExamRequestCandidates } from '@/features/census/controllers/censusExamRequestController';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';

vi.mock('@/hooks/controllers/examRequestPrintController', () => ({
  runExamRequestPrint: vi.fn(),
}));
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const CENSUS_DATE = '2026-11-08';
const visibleBeds: BedDefinition[] = ['R1', 'R2', 'R3'].map(id => ({
  id,
  name: id,
  type: BedType.UTI,
  isCuna: false,
}));
const ana = DataFactory.createMockPatient('R1', {
  patientName: 'ANA SINTETICA',
  rut: '11.111.111-1',
  clinicalEpisodeId: 'ep-ana',
});
const bruno = DataFactory.createMockPatient('R2', {
  patientName: 'BRUNO SINTETICO',
  rut: '22.222.222-2',
  clinicalEpisodeId: 'ep-bruno',
});
const emptyBed = (bedId: string) =>
  DataFactory.createMockPatient(bedId, { patientName: '', rut: '' });
const census = { R1: ana, R2: bruno, R3: emptyBed('R3') };

/** Ana's row as the census renders it: its own open flag and the real permission check. */
const AnaRow: React.FC<{ data: typeof ana }> = ({ data }) => {
  const [showExamRequest, setShowExamRequest] = useState(false);
  const { canOpenExamRequest } = resolvePatientRowCapabilities({
    role: 'admin',
    patient: data,
    isBlocked: false,
    isEmpty: !data.patientName,
  });
  return (
    <>
      <button type="button" onClick={() => setShowExamRequest(true)}>
        Solicitud de laboratorio R1
      </button>
      <PatientRowModals
        bedId="R1"
        data={data}
        currentDateString={CENSUS_DATE}
        isSubRow={false}
        showDemographics={false}
        showClinicalDocuments={false}
        canOpenClinicalDocuments={false}
        showExamRequest={showExamRequest}
        canOpenExamRequest={canOpenExamRequest}
        showImagingRequest={false}
        canOpenImagingRequest
        showHistory={false}
        canOpenHistory
        onCloseDemographics={vi.fn()}
        onCloseClinicalDocuments={vi.fn()}
        onCloseExamRequest={() => setShowExamRequest(false)}
        onCloseImagingRequest={vi.fn()}
        onCloseHistory={vi.fn()}
        onSaveDemographics={vi.fn()}
        onSaveCribDemographics={vi.fn()}
        onRevertEmptyDemographics={vi.fn()}
      />
    </>
  );
};

const Census: React.FC<{ beds: typeof census; inCensus?: boolean }> = ({
  beds,
  inCensus = true,
}) => {
  const candidates = listCensusExamRequestCandidates({ visibleBeds, beds });
  return (
    <CensusExamRequestCandidatesContext.Provider value={inCensus ? candidates : null}>
      <CensusExamOrderDateContext.Provider value={inCensus ? CENSUS_DATE : null}>
        <AnaRow data={beds.R1} />
      </CensusExamOrderDateContext.Provider>
      {inCensus && <CensusExamOrderLauncher censusDate={CENSUS_DATE} candidates={candidates} />}
    </CensusExamRequestCandidatesContext.Provider>
  );
};

const openFromAnaRow = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Solicitud de laboratorio R1' }));
  return screen.findByRole('tablist', { name: 'Pacientes de la solicitud' });
};

describe('laboratory request opened from one census row', () => {
  beforeAll(async () => {
    await import('@/components/modals/ExamRequestModal');
  });

  afterEach(() => {
    cleanup();
    act(() => closeExamOrderRequest());
  });

  it('adds other census patients as tabs and removes them again', async () => {
    render(<Census beds={census} />);
    const tablist = await openFromAnaRow();
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

  it('keeps the added orders when the patient who opened it is discharged', async () => {
    const view = render(<Census beds={census} />);
    await openFromAnaRow();
    fireEvent.click(screen.getByRole('button', { name: /Paciente/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /BRUNO SINTETICO/ }));
    const brunoForm = () =>
      screen.getAllByTestId('exam-request-form').find(form => !form.classList.contains('hidden'))!;
    fireEvent.change(within(brunoForm()).getByRole('textbox', { name: 'OTROS' }), {
      target: { value: 'Procalcitonina' },
    });

    // Ana is discharged: her bed empties and her row can no longer open a request.
    const withoutAna = { ...census, R1: emptyBed('R1') };
    expect(
      resolvePatientRowCapabilities({
        role: 'admin',
        patient: withoutAna.R1,
        isBlocked: false,
        isEmpty: true,
      }).canOpenExamRequest
    ).toBe(false);
    view.rerender(<Census beds={withoutAna} />);

    const tablist = screen.getByRole('tablist', { name: 'Pacientes de la solicitud' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(1);
    expect(within(tablist).getByRole('tab')).toHaveTextContent('BRUNO SINTETICO');
    expect(within(brunoForm()).getByRole('textbox', { name: 'OTROS' })).toHaveValue(
      'Procalcitonina'
    );
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();

    // With nobody left, the request says so instead of vanishing.
    view.rerender(<Census beds={{ ...withoutAna, R2: emptyBed('R2') }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/ya no están en el censo/);
    expect(screen.queryByRole('button', { name: /Imprimir/ })).not.toBeInTheDocument();
  });

  it('stays a single-patient request outside the census', async () => {
    render(<Census beds={census} inCensus={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Solicitud de laboratorio R1' }));
    expect(await screen.findByTestId('exam-request-form')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
  });
});
