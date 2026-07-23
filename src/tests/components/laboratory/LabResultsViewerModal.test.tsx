/**
 * @fileoverview Unit tests for the LabResultsViewerModal component.
 * Tests rendering states: empty, exam list, PDF viewer, analysis, and error display.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.unmock('@/features/laboratory/components/LabResultsViewerModal');
vi.unmock('@/features/laboratory/components/LabViewerControls');
vi.unmock('@/features/laboratory/components/LabViewerProgress');
vi.unmock('@/features/laboratory/components/LabViewerExamList');
vi.unmock('@/features/laboratory/components/LabViewerAnalyzeBar');
vi.unmock('@/features/laboratory/components/LabViewerPdf');
vi.unmock('@/features/laboratory/components/LabViewerAnalysis');
vi.unmock('@/features/laboratory/components/LabViewerTrendCharts');
vi.unmock('@/features/laboratory/components/LabViewerComparisonTable');
vi.unmock('@/features/laboratory/components/LabExportConfigDialog');
vi.unmock('@/features/laboratory/components/LabViewerEmptyState');
vi.unmock('@/features/laboratory/components/SyslabAccessPrompt');
vi.unmock('@/features/laboratory/constants/labConstants');
vi.unmock('@/features/laboratory/types/labViewerTypes');

// Mock BaseModal to render title + children
vi.mock('@/components/shared/BaseModal', () => ({
  BaseModal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="base-modal">
        <div>{title}</div>
        {children}
      </div>
    ) : null,
}));

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceArea: () => null,
}));

const mockUseLabViewer = vi.fn();
vi.mock('@/features/laboratory/hooks/useLabViewer', () => ({
  useLabViewer: (...args: unknown[]) => mockUseLabViewer(...args),
}));

const mockUseSyslabAccess = vi.fn();
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: (...args: unknown[]) => mockUseSyslabAccess(...args),
}));

vi.mock('@/features/laboratory/controllers/labFormattingController', () => ({
  isOutOfRange: (result: string, ref: string) => {
    const m = ref.match(/([\d.]+)-([\d.]+)/);
    if (!m) return null;
    const v = parseFloat(result);
    if (isNaN(v)) return null;
    return v < parseFloat(m[1]) || v > parseFloat(m[2]);
  },
  formatLabResult: (result: string, unit: string) => ({ display: result, displayUnit: unit }),
}));

vi.mock('@/features/laboratory/services/labExcelService', () => ({
  exportComparisonToExcel: vi.fn(),
}));

vi.mock('@/services/laboratory/syslabService', () => ({
  buildSyslabPdfUrl: (link: string) =>
    `http://localhost:3000/api/exams/pdf?link=${encodeURIComponent(link)}`,
  fetchSyslabPdfBlobUrl: vi.fn(async () => 'blob:syslab-test'),
}));

import { LabResultsViewerModal } from '@/features/laboratory';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const PATIENTS: LabPatient[] = [
  {
    bedId: 'R1',
    label: 'R1 · Juan',
    patientName: 'Juan',
    rut: '12345678-9',
    birthDate: '1980-04-12',
  },
  { bedId: 'R2', label: 'R2 · María', patientName: 'María', rut: '98765432-1' },
];

const MOCK_EXAM: SyslabExamItem = {
  id: '43091284',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091284',
  date: '06/04/2026',
  time: '13:08:43',
  patientName: 'JUAN',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA', 'GLICEMIA'],
};

const MOCK_ANALYSIS: LabAnalysisData = {
  trendGroups: [
    {
      label: 'Hemograma',
      variables: {
        Hemoglobina: [
          {
            date: '01/03/2026',
            isoDate: '2026-03-01',
            value: 13.2,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
          {
            date: '06/04/2026',
            isoDate: '2026-04-06',
            value: 14.5,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
        ],
      },
    },
  ],
  examDates: ['01/03/2026', '06/04/2026'],
  microbiologyEntries: [
    {
      category: 'urocultivo',
      date: '06/04/2026 13:08',
      examLabel: 'UROCULTIVO',
      findings: [{ analysis: 'Cultivo', result: 'Desarrollo de E. coli' }],
      hasAlertFinding: true,
      sourceExam: MOCK_EXAM,
    },
    {
      category: 'otros_cultivos',
      date: '06/04/2026 13:08',
      examLabel: 'Otros cultivos',
      findings: [],
      hasAlertFinding: false,
      sourceExam: MOCK_EXAM,
    },
  ],
  comparison: {
    Hemoglobina: {
      '01/03/2026': {
        section: 'HEMOGRAMA',
        analysis: 'Hemoglobina',
        result: '13.2',
        unit: 'g/dL',
        refValue: '12-16',
      },
      '06/04/2026': {
        section: 'HEMOGRAMA',
        analysis: 'Hemoglobina',
        result: '14.5',
        unit: 'g/dL',
        refValue: '12-16',
      },
    },
  },
};

const DEFAULT_HOOK_STATE = {
  uniquePatients: PATIENTS,
  selectedPatient: PATIENTS[0],
  selectedRut: '12345678-9',
  isLoading: false,
  examList: [] as SyslabExamItem[],
  pdfExam: null,
  error: null,
  progress: null,
  selectedExamIds: new Set<string>(),
  isAnalyzing: false,
  analysisData: null,
  analysisView: 'trends' as const,
  selectPatient: vi.fn(),
  search: vi.fn(),
  openPdf: vi.fn(),
  closePdf: vi.fn(),
  reset: vi.fn(),
  toggleExamSelection: vi.fn(),
  selectAllExams: vi.fn(),
  clearSelection: vi.fn(),
  selectByDays: vi.fn(),
  filteredExamList: [] as SyslabExamItem[],
  examFilterCategories: [] as string[],
  activeExamFilter: null,
  setExamFilter: vi.fn(),
  analyzeSelected: vi.fn(),
  copyExamSummary: vi.fn(),
  closeAnalysis: vi.fn(),
  setAnalysisView: vi.fn(),
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('LabResultsViewerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLabViewer.mockReturnValue({ ...DEFAULT_HOOK_STATE });
    mockUseSyslabAccess.mockReturnValue({
      state: 'connected',
      message: 'Sesión de Syslab activa.',
      isOpening: false,
      isAwaitingLogin: false,
      refresh: vi.fn(),
      openLogin: vi.fn(),
    });
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <LabResultsViewerModal isOpen={false} onClose={vi.fn()} patients={PATIENTS} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title when open', () => {
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('Laboratorio / Exámenes Syslab')).toBeInTheDocument();
  });

  it('shows empty state by default', () => {
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('Selecciona un paciente y busca')).toBeInTheDocument();
  });

  it('opens the extension-owned credential window when Syslab requires login', async () => {
    const openLogin = vi.fn();
    mockUseSyslabAccess.mockReturnValue({
      state: 'login-required',
      message: 'Syslab requiere iniciar sesión.',
      isOpening: false,
      isAwaitingLogin: false,
      refresh: vi.fn(),
      openLogin,
    });

    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);

    const loginButton = await screen.findByRole('button', { name: 'Iniciar sesión en Syslab' });
    await userEvent.click(loginButton);

    expect(openLogin).toHaveBeenCalledTimes(1);
  });

  it('shows exam list with checkboxes', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      examList: [MOCK_EXAM],
      filteredExamList: [MOCK_EXAM],
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    // Controls render (Buscar button visible) and empty state is gone
    expect(screen.getByText('Buscar')).toBeInTheDocument();
    expect(screen.queryByText('Selecciona un paciente y busca')).toBeNull();
  });

  it('shows analyze bar when exams are selected', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      examList: [MOCK_EXAM],
      filteredExamList: [MOCK_EXAM],
      selectedExamIds: new Set(['43091284']),
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText(/1 examen seleccionado/)).toBeInTheDocument();
    expect(screen.getByText(/Analizar/)).toBeInTheDocument();
  });

  it('shows error message', () => {
    mockUseLabViewer.mockReturnValue({ ...DEFAULT_HOOK_STATE, error: 'Server down' });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('Server down')).toBeInTheDocument();
  });

  it('shows PDF viewer when pdfExam is set', async () => {
    mockUseLabViewer.mockReturnValue({ ...DEFAULT_HOOK_STATE, pdfExam: MOCK_EXAM });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    const iframe = screen.getByTitle('PDF Examen 43091284');
    expect(iframe).toBeInTheDocument();
    await waitFor(() => {
      expect(iframe).toHaveAttribute('src', 'blob:syslab-test#navpanes=0&scrollbar=1&zoom=110');
    });
  });

  it('prioritizes PDF viewer over analysis when both states exist', async () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      pdfExam: MOCK_EXAM,
      analysisData: MOCK_ANALYSIS,
      analysisView: 'microbiology',
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    const iframe = screen.getByTitle('PDF Examen 43091284');
    expect(iframe).toBeInTheDocument();
    await waitFor(() => {
      expect(iframe).toHaveAttribute('src', 'blob:syslab-test#navpanes=0&scrollbar=1&zoom=110');
    });
    expect(screen.queryByText('Resultados cualitativos relevantes')).not.toBeInTheDocument();
  });

  it('shows analysis view with tabs', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    // Controls hidden during analysis (no Buscar button) and empty state is gone
    expect(screen.queryByText('Buscar')).toBeNull();
    expect(screen.queryByText('Selecciona un paciente y busca')).toBeNull();
    expect(screen.getByText('Microbiología')).toBeInTheDocument();
  });

  it('trends tab shows grouped charts', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
      analysisView: 'trends',
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('Hemograma')).toBeInTheDocument();
  });

  it('comparison tab shows pivot table', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
      analysisView: 'comparison',
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('01/03/2026')).toBeInTheDocument();
    expect(screen.getByText('06/04/2026')).toBeInTheDocument();
    expect(screen.getByText('13.2')).toBeInTheDocument();
  });

  it('keeps comparison analysis header compact with patient and RUT in one place', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
      analysisView: 'comparison',
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);

    expect(screen.getByText('Juan')).toBeInTheDocument();
    expect(screen.getByText('RUT 12345678-9')).toBeInTheDocument();
    expect(screen.queryByText('Análisis clínico')).not.toBeInTheDocument();
    expect(screen.queryByText('2 examenes analizados')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Compara variables por fecha en una vista más compacta.')
    ).not.toBeInTheDocument();
  });

  it('microbiology tab shows separated microbiology content', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
      analysisView: 'microbiology',
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.getByText('Resultados cualitativos relevantes')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /ver pdf original de urocultivo/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Resultado disponible en PDF original.')).toBeInTheDocument();
  });

  it('calls analyzeSelected when Analizar button is clicked', async () => {
    const analyzeFn = vi.fn();
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      examList: [MOCK_EXAM],
      filteredExamList: [MOCK_EXAM],
      selectedExamIds: new Set(['43091284']),
      analyzeSelected: analyzeFn,
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    await userEvent.click(screen.getByText(/Analizar/));
    expect(analyzeFn).toHaveBeenCalledTimes(1);
  });

  it('hides patient controls during analysis', () => {
    mockUseLabViewer.mockReturnValue({
      ...DEFAULT_HOOK_STATE,
      analysisData: MOCK_ANALYSIS,
    });
    render(<LabResultsViewerModal isOpen={true} onClose={vi.fn()} patients={PATIENTS} />);
    expect(screen.queryByText('Paciente')).not.toBeInTheDocument();
  });
});
