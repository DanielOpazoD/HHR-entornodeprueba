import { confirmedReportInput } from '@/tests/services/cudyr/reportFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    confirmedReportInput({
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
  it('shows historical provenance without changing eligibility or compliance', () => {
    const data = fixture();
    data.rows.find(r => r.patientName === 'Paciente Sintético')!.monthlyEvidence = {
      reportId: 'source',
      sourceDate: '2026-10-03',
      checkedAt: '2026-10-08T18:00:00Z',
      state: 'found',
    };
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(screen.getAllByText('100%')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Fuente del CUDYR de Paciente Sintético' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Resultado válido de Eloísa');
    expect(screen.getByRole('dialog')).toHaveTextContent('2026-10-03');
    expect(screen.getByRole('dialog')).toHaveTextContent('2026-10-02 · noche');
    expect(screen.getByRole('dialog')).toHaveTextContent('Día en Eloísa');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Gestión de Camas → Informes → Categorización de riesgo dependencia'
    );
  });
  it('keeps verified CUDYR distinct from census completeness with detail collapsed', () => {
    const data = fixture();
    data.coverage = data.coverage.filter(day => day.date === '2026-10-02');
    data.from = '2026-10-02';
    data.to = '2026-10-02';
    data.rows.forEach(row => {
      row.monthlyEvidence = {
        reportId: 'source',
        sourceDate: '2026-10-03',
        checkedAt: '2026-10-08T18:00:00Z',
        state: 'found',
      };
    });
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    const summary = screen.getByLabelText('Estado del archivo CUDYR');
    expect(summary).toHaveTextContent('CUDYR verificados · 1/1 días');
    expect(summary).toHaveTextContent('Pacientes del censo por confirmar');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText(/censos por cotejar/)).not.toBeInTheDocument();
  });
  it('labels confirmed absence without treating an incomplete query as unregistered', () => {
    const data = fixture();
    const own = data.rows.find(row => row.patientName === 'Paciente Sintético')!;
    own.evaluation = null;
    own.cudyrStatus = 'sin_registro_observado';
    const crib = data.rows.find(row => row.patientName === 'RN sintético')!;
    crib.evaluation = null;
    crib.cudyrStatus = 'sin_captura';
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(
      within(screen.getByRole('row', { name: /Paciente Sintético/ })).getByText('No registrado')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /RN sintético/ })).getByText('Verificación pendiente')
    ).toBeInTheDocument();
  });
  it('shows No aplica for an excluded open-window case without hiding recorded results', () => {
    const data = fixture();
    const crib = data.rows.find(row => row.patientName === 'RN sintético')!;
    crib.applicationPending = true;
    crib.evaluation = null;
    crib.cudyrStatus = 'sin_captura';
    const eligible = data.rows.find(row => row.patientName === 'Paciente Sintético')!;
    eligible.applicationPending = true;
    eligible.evaluation = null;
    eligible.cudyrStatus = 'sin_captura';
    data.rows.push({
      ...crib,
      key: 'recorded-crib',
      patientName: 'RN registrado',
      cudyrStatus: 'registrado',
      evaluation: fixture().rows[0].evaluation,
    });
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(
      within(screen.getByRole('row', { name: /RN sintético/ })).getByText('No aplica')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /RN sintético/ })).queryByText(
        'Pendiente de aplicación'
      )
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Paciente Sintético/ })).getByText(
        'Pendiente de aplicación'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /RN registrado/ })).getByText('Registrado')
    ).toBeInTheDocument();
  });
  it('shows cumulative eligible compliance and read-only totals without entry or bulk deletion controls', () => {
    render(<CudyrView />);
    expect(screen.getAllByText('100%')).toHaveLength(2);
    expect(screen.getByText('Cumplimiento del día')).toBeInTheDocument();
    expect(screen.getByText('RN sintético')).toBeInTheDocument();
    expect(screen.getByText('Cuna RN')).toBeInTheDocument();
    expect(
      screen.getByText(/1 CUDYR disponibles \/ 1 pacientes-día elegibles/)
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'P. DEP' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Guardar CUDYR|Eliminar varios|Editar/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
  it('shows registration separately from pending and excluded eligibility', () => {
    const data = fixture();
    const pending = data.rows.find(row => row.patientName === 'Paciente Sintético')!;
    pending.eligibility = 'por_revisar';
    pending.applicationPending = true;
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    const row = screen.getByRole('row', { name: /Paciente Sintético/ });
    expect(within(row).getByText('Registrado')).toBeInTheDocument();
    expect(within(row).getByText('Elegibilidad pendiente')).toBeInTheDocument();
    const crib = screen.getByRole('row', { name: /RN sintético/ });
    expect(within(crib).getByText('Registrado')).toBeInTheDocument();
    expect(within(crib).getByText('Cuna RN')).toBeInTheDocument();
  });
  it('places the medico-surgical bed type beside the exact Eloísa name, without classifying CMA or cribs as media/intermedia', () => {
    const data = fixture();
    const hospital = data.rows.find(row => row.patientName === 'Paciente Sintético')!;
    const crib = data.rows.find(row => row.patientName === 'RN sintético')!;
    data.rows = [
      { ...hospital, bedName: 'R1', group: 'intermedia' },
      {
        ...hospital,
        key: 'neo',
        patientName: 'Caso media',
        bedName: 'Neo1',
        bedId: 'NEO1',
        group: 'media',
      },
      {
        ...hospital,
        key: 'cma',
        patientName: 'Caso CMA',
        bedName: 'CMA R1 Hospitalizados',
        modality: 'cma',
        eligibility: 'no_elegible',
      },
      {
        ...hospital,
        key: 'pabellon',
        patientName: 'Caso pabellón',
        bedName: 'Pabellón-R1 CMA',
        modality: 'cma',
        eligibility: 'no_elegible',
      },
      crib,
    ];
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(
      within(screen.getByRole('table', { name: /Medias:/ }))
        .getAllByRole('columnheader')
        .slice(0, 3)
        .map(header => header.textContent)
    ).toEqual(['Cama · Eloísa', 'Tipo de cama', 'Paciente']);
    expect(
      within(screen.getByRole('row', { name: /Paciente Sintético/ })).getByText('Intermedia')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Caso media/ })).getByText('Media')
    ).toBeInTheDocument();
    for (const name of ['Caso CMA', 'Caso pabellón', 'RN sintético']) {
      const cells = within(screen.getByRole('row', { name: new RegExp(name) })).getAllByRole(
        'cell'
      );
      expect(cells[1]).toHaveTextContent('—');
    }
    expect(screen.getByText('CMA R1 Hospitalizados')).toBeInTheDocument();
    expect(screen.getByText('Pabellón-R1 CMA')).toBeInTheDocument();
  });
  it('keeps exclusions visible, allows patient review, and returns to census', () => {
    render(<CudyrView />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_elegible' } });
    expect(screen.getByText('RN sintético')).toBeInTheDocument();
    expect(screen.queryByText('Paciente Sintético')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar excepción manual de RN sintético' })
    );
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
      confirmedReportInput({
        generatedAt: '2026-10-03T20:00:00-05:00',
        records: [reportRecord('2026-10-02'), reportRecord('2026-10-03')],
      })
    );
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView currentDate="2026-10-03" />);
    expect(screen.getAllByText('100%')).toHaveLength(1);
    expect(screen.getAllByText('Pendiente de aplicación').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/1 CUDYR disponibles \/ 1 pacientes-día elegibles/)
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
  it('shows yesterday progress before noon without including the day in closed monthly totals', () => {
    const data = fixture();
    data.generatedAt = '2026-10-03T09:00:00-05:00';
    data.rows.forEach(row => {
      row.applicationPending = true;
    });
    data.rows.push({
      ...data.rows.find(row => row.eligibility === 'elegible')!,
      key: 'missing',
      patientName: 'Sin resultado',
      cudyrStatus: 'sin_captura',
      evaluation: null,
    });
    data.rows.push({
      ...data.rows.find(row => row.eligibility === 'elegible')!,
      key: 'review',
      patientName: 'Contexto pendiente',
      eligibility: 'por_revisar',
    });
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView currentDate="2026-10-02" />);
    const daily = within(screen.getByRole('group', { name: 'Cumplimiento del día' }));
    expect(daily.getByText('50%')).toBeInTheDocument();
    expect(daily.getByText('1 / 2 elegibles · Provisional')).toBeInTheDocument();
    expect(
      screen.getByText(/0 CUDYR disponibles \/ 0 pacientes-día elegibles/)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_elegible' } });
    expect(daily.getByText('50%')).toBeInTheDocument();
  });
  it('does not invent 100 percent for a day containing only exclusions', () => {
    const data = fixture();
    data.rows = data.rows.filter(row => row.eligibility === 'no_elegible');
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    const daily = within(screen.getByRole('group', { name: 'Cumplimiento del día' }));
    expect(daily.getByText('—')).toBeInTheDocument();
    expect(daily.getByText(/0 \/ 0 elegibles/)).toBeInTheDocument();
  });
  it('hides confirmed system departures even in all/excluded filters, keeping manual exceptions visible', () => {
    const data = fixture();
    data.rows.push({
      ...data.rows[0],
      key: 'resolved',
      patientName: 'Salida confirmada',
      resolvedSystemDeparture: true,
      eligibility: 'no_elegible',
    });
    mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
    render(<CudyrView />);
    expect(screen.queryByText('Salida confirmada')).not.toBeInTheDocument();
    expect(screen.getByText('RN sintético')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_elegible' } });
    expect(screen.queryByText('Salida confirmada')).not.toBeInTheDocument();
  });
  it('opens archived bed movements without loading again or changing an exclusion', () => {
    render(<CudyrView />);
    fireEvent.click(screen.getByRole('button', { name: 'Movimientos de Paciente Sintético' }));
    expect(screen.getByText('Primer ingreso registrado a Hospitalizados')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Entrada' })).toBeInTheDocument();
    expect(screen.getByText(/La lista puede estar incompleta/)).toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('keeps the cached table visible while verifying Firebase and disables unverified export', () => {
    mocks.report.mockReturnValue({ data: fixture(), busy: true, error: '', load: mocks.load });
    const { rerender } = render(<CudyrView />);
    expect(screen.getByText('Paciente Sintético')).toBeInTheDocument();
    expect(screen.getByText('Actualizando…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excel mensual' })).toBeDisabled();
    mocks.report.mockReturnValue({
      data: fixture(),
      busy: false,
      error: 'Sin conexión',
      load: mocks.load,
    });
    rerender(<CudyrView />);
    expect(screen.getByText('Paciente Sintético')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excel mensual' })).toBeDisabled();
  });
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

it('shows an approved reconstruction as official while retaining the original mismatch only in details', () => {
  const data = fixture();
  data.coverage.forEach(day => {
    day.censusVerification = {
      state: 'mismatch',
      missing: 1,
      extra: 1,
      reason: 'Diferencia histórica con informe Eloísa',
    };
    day.reconstructionApproval = {
      approvedAt: '2026-10-08T20:00:00Z',
      approvedBy: 'Responsable',
      reason: 'Reconstrucción aceptada',
    };
  });
  data.rows
    .filter(r => r.eligibility !== 'no_elegible')
    .forEach(row => {
      row.monthlyEvidence = {
        reportId: 'source',
        sourceDate: '2026-10-03',
        checkedAt: '2026-10-08T20:00:00Z',
        state: 'found',
      };
    });
  mocks.report.mockReturnValue({ data, busy: false, error: '', load: mocks.load });
  render(<CudyrView />);
  expect(screen.getByText('Oficial · reparado')).toBeInTheDocument();
  expect(screen.queryByText('Pacientes del censo por confirmar')).not.toBeInTheDocument();
  expect(screen.getByText('Nota del cotejo original con Eloísa')).not.toBeVisible();
  expect(screen.getByText(/No elegibles del mes/)).toBeInTheDocument();
});
