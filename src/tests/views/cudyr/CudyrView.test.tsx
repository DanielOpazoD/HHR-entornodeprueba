import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CudyrView } from '@/features/cudyr/components/CudyrView';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput, reportPatient, reportRecord } from '@/tests/services/cudyr/reportFixtures';
const mocks = vi.hoisted(() => ({ load: vi.fn(), setModule: vi.fn(), report: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: { date: '2026-10-02' } }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'admin', currentUser: { uid: 'synthetic' } }),
}));
vi.mock('@/hooks/useUIState', () => ({
  useUIState: () => ({ setCurrentModule: mocks.setModule }),
}));
vi.mock('@/features/cudyr/hooks/useCudyrReport', () => ({ useCudyrReport: () => mocks.report() }));
vi.mock('@/features/cudyr/components/CudyrExclusionDialog', () => ({
  CudyrExclusionDialog: ({ row }: { row: { patientName: string } }) => (
    <div role="dialog">Revisando {row.patientName}</div>
  ),
}));
const fixture = () =>
  buildCudyrReport(
    reportInput({
      records: [
        reportRecord('2026-10-02', {
          R1: reportPatient(),
          H1C1: reportPatient({
            bedId: 'H1C1',
            clinicalEpisodeId: 'crib',
            bedMode: 'Cuna',
            patientName: 'RN sintético',
          }),
        }),
      ],
    })
  );
describe('CUDYR daily control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.mockReturnValue({ data: fixture(), busy: false, error: '', load: mocks.load });
  });
  it('shows cumulative eligible compliance and read-only totals without entry or bulk deletion controls', () => {
    render(<CudyrView />);
    expect(screen.getAllByText('100%')).toHaveLength(2);
    expect(screen.getByText('Cumplimiento del día')).toBeInTheDocument();
    expect(screen.queryByText('RN sintético')).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 CUDYR confirmados \/ 1 pacientes-día elegibles/)
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'P. DEP' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Guardar CUDYR|Eliminar varios|Editar/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
  it('keeps exclusions visible, allows patient review, and returns to census', () => {
    render(<CudyrView />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_elegible' } });
    expect(screen.getByText('RN sintético')).toBeInTheDocument();
    expect(screen.queryByText('Paciente Sintético')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar elegibilidad de RN sintético' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('RN sintético');
    fireEvent.click(screen.getByRole('button', { name: 'Volver al censo' }));
    expect(mocks.setModule).toHaveBeenCalledWith('CENSUS');
  });
  it('blocks downloads on incomplete exclusions and refreshes stored data only', () => {
    mocks.report.mockReturnValue({
      data: { ...fixture(), issues: ['Exclusiones diarias: lectura incompleta.'] },
      busy: false,
      error: '',
      load: mocks.load,
    });
    render(<CudyrView />);
    expect(screen.getByRole('button', { name: 'Excel mensual' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar vista' }));
    expect(mocks.load).toHaveBeenCalledWith('2026-10-01', '2026-10-02');
  });
  it('keeps today outside daily and monthly compliance while preserving past days', () => {
    const data = buildCudyrReport(
      reportInput({
        generatedAt: '2026-10-03T20:00:00-05:00',
        records: [reportRecord('2026-10-02'), reportRecord('2026-10-03')],
      })
    );
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView currentDate="2026-10-03" />);
    expect(screen.getAllByText('100%')).toHaveLength(1);
    expect(screen.getAllByText('Pendiente de aplicación').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/1 CUDYR confirmados \/ 1 pacientes-día elegibles/)
    ).toBeInTheDocument();
  });
  it.each([
    ['2026-10-03', true],
    ['2026-10-02', false],
  ] as const)(
    'only blocks export when the failed census %s belongs to a closed day',
    (failedDate, enabled) => {
      const data = buildCudyrReport(
        reportInput({
          generatedAt: '2026-10-03T20:00:00-05:00',
          records: [reportRecord('2026-10-02')],
        })
      );
      data.coverage.find(day => day.date === failedDate)!.state = 'error';
      mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
      render(<CudyrView currentDate="2026-10-03" />);
      const download = screen.getByRole('button', { name: 'Excel mensual' });
      if (enabled) expect(download).toBeEnabled();
      else expect(download).toBeDisabled();
    }
  );
  it('shows missing component scores as unknown instead of zero', () => {
    const data = fixture();
    const patient = data.rows.find(row => row.eligibility === 'elegible')!;
    patient.evaluation = {
      ...patient.evaluation!,
      dependencyScore: null,
      riskScore: undefined,
    };
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
