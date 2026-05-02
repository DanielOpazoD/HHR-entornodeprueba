import { render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientEpisodeTimeline } from '@/features/census/components/global-search/PatientEpisodeTimeline';
import { usePatientSelection } from '@/features/census/components/global-search/usePatientSelection';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';

const mockGetPatientMovementHistory = vi.fn();

vi.mock('@/services/patient/patientHistoryService', () => ({
  getPatientMovementHistory: (...args: unknown[]) => mockGetPatientMovementHistory(...args),
}));

const patientWithPartialMasterIndex: MasterPatient = {
  rut: '18.781.542-8',
  fullName: 'Tipanie Carossi Pakomio',
  birthDate: '1994-03-09',
  gender: 'Femenino',
  forecast: 'Fonasa',
  createdAt: 1,
  updatedAt: 1,
  lastAdmission: '2026-04-12',
  lastDischarge: '2026-04-24',
  hospitalizations: [
    {
      id: 'master-latest-admission',
      type: 'Ingreso',
      date: '2026-04-12',
      diagnosis: 'ACV',
      bedName: 'H2C2',
    },
  ],
};

const completeRemoteHistory: PatientHistoryResult = {
  patientName: patientWithPartialMasterIndex.fullName,
  rut: patientWithPartialMasterIndex.rut,
  totalDays: 29,
  firstSeen: '2026-03-26',
  lastSeen: '2026-04-24',
  movements: [
    {
      date: '2026-03-26',
      bedId: 'R4',
      bedName: 'R4',
      bedType: 'MEDIA',
      type: 'admission',
      details: 'Urgencias',
    },
    {
      date: '2026-04-02',
      bedId: 'H4C1',
      bedName: 'H4C1',
      bedType: 'MEDIA',
      type: 'internal_move',
      details: 'Desde cama R4',
    },
    {
      date: '2026-04-06',
      bedId: 'H4C1',
      bedName: 'H4C1',
      bedType: 'MEDIA',
      type: 'discharge',
      details: 'Domicilio (Habitual)',
    },
    {
      date: '2026-04-12',
      bedId: 'H2C2',
      bedName: 'H2C2',
      bedType: 'MEDIA',
      type: 'admission',
      details: 'Urgencias',
    },
    {
      date: '2026-04-24',
      bedId: 'H2C2',
      bedName: 'H2C2',
      bedType: 'MEDIA',
      type: 'discharge',
      details: 'Domicilio (Habitual)',
    },
  ],
};

const PatientSelectionHarness = ({ patient }: { patient: MasterPatient }) => {
  const selection = usePatientSelection();

  useEffect(() => {
    void selection.selectPatient(patient);
    // The harness intentionally exercises the first selection flow once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient]);

  if (!selection.selectedPatient) {
    return null;
  }

  return (
    <PatientEpisodeTimeline
      patient={selection.selectedPatient.master}
      history={selection.selectedPatient.history}
      isLoadingHistory={selection.selectedPatient.isLoadingHistory}
      timelineState={selection.selectedPatient.timelineState}
      episodeDocuments={selection.episodeDocuments}
      onLoadDocuments={selection.loadEpisodeDocuments}
      onDownloadPdf={selection.downloadDocumentPdf}
      onBack={selection.clearSelection}
    />
  );
};

describe('global patient search timeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPatientMovementHistory.mockResolvedValue(completeRemoteHistory);
  });

  it('hydrates remote history and renders all readmission episodes without false bed changes', async () => {
    render(<PatientSelectionHarness patient={patientWithPartialMasterIndex} />);

    await waitFor(() =>
      expect(mockGetPatientMovementHistory).toHaveBeenCalledWith(
        patientWithPartialMasterIndex.rut,
        expect.objectContaining({
          forceFullRemoteHydration: true,
          hospitalizationHints: patientWithPartialMasterIndex.hospitalizations,
        })
      )
    );

    await screen.findByText('Episodios de hospitalizacion (2)');

    expect(screen.getByTestId('patient-search-detail')).toHaveClass('gap-2');
    expect(screen.getByTestId('episode-list')).not.toHaveClass('overflow-y-auto');
    expect(screen.getAllByText('26-03-2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('06-04-2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12-04-2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('24-04-2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Domicilio \(Habitual\)/)).toHaveLength(2);

    const bedChangeRow = screen.getByTestId('movement-row-internal_move-1');
    expect(bedChangeRow).toHaveClass('ml-7');
    expect(within(bedChangeRow).getByText('Cambio de cama')).toBeInTheDocument();
    expect(within(bedChangeRow).getByText(/Desde cama R4/)).toBeInTheDocument();

    const readmissionRow = screen.getByTestId('movement-row-admission-3');
    expect(within(readmissionRow).getByText('Ingreso')).toBeInTheDocument();
    expect(within(readmissionRow).getByText(/H2C2/)).toBeInTheDocument();
    expect(screen.queryByText(/Desde cama H4C1/)).not.toBeInTheDocument();
  });
});
