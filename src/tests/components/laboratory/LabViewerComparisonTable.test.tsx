import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

import { LabViewerComparisonTable } from '@/features/laboratory/components/LabViewerComparisonTable';
import type { LabPatient } from '@/types/domain/labExamTypes';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { exportComparisonToExcel } from '@/features/laboratory/services/labExcelService';

const MOCK_PATIENT: LabPatient = {
  bedId: 'R1',
  label: 'R1 · Test',
  patientName: 'Test',
  rut: '12345678-9',
  birthDate: '1980-04-12',
};

const MOCK_ANALYSIS: LabAnalysisData = {
  trendGroups: [],
  examDates: ['08/04/2026 14:00'],
  microbiologyEntries: [],
  comparison: {
    Hemoglobina: {
      '08/04/2026 14:00': {
        section: 'HG',
        analysis: 'Hemoglobina',
        result: '13',
        unit: 'g/dL',
        refValue: '12-16',
      },
    },
  },
};

describe('LabViewerComparisonTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes patient context to the Excel exporter', async () => {
    const user = userEvent.setup();
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);

    await user.click(screen.getByText('Exportar Excel'));
    await user.click(screen.getAllByText('Exportar Excel')[1]);

    expect(exportComparisonToExcel).toHaveBeenCalledWith(
      MOCK_ANALYSIS,
      expect.objectContaining({
        selectedDates: expect.any(Set),
        selectedVars: expect.any(Set),
      }),
      MOCK_PATIENT
    );
  });

  it('renders variable names as rows', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);
    expect(screen.getByText('Hemoglobina')).toBeInTheDocument();
  });

  it('renders date columns', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);
    expect(screen.getByText('08/04/2026 14:00')).toBeInTheDocument();
  });

  it('keeps the comparison header compact without repeated patient or explanatory copy', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);

    expect(screen.queryByText('Tabla resumida por fechas')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Compara variables por fecha en una vista más compacta.')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rut 12345678-9/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('toggles comparison columns between exact date-time and date-only labels', async () => {
    const user = userEvent.setup();
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);

    expect(screen.getByText('08/04/2026 14:00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /solo fecha/i }));

    expect(screen.getByText('08/04/2026')).toBeInTheDocument();
    expect(screen.queryByText('08/04/2026 14:00')).not.toBeInTheDocument();
  });

  it('passes the active column time mode to the Excel exporter', async () => {
    const user = userEvent.setup();
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);

    await user.click(screen.getByRole('button', { name: /solo fecha/i }));
    await user.click(screen.getByText('Exportar Excel'));
    await user.click(screen.getAllByText('Exportar Excel')[1]);

    expect(exportComparisonToExcel).toHaveBeenCalledWith(
      MOCK_ANALYSIS,
      expect.objectContaining({
        includeTimeInColumns: false,
      }),
      MOCK_PATIENT
    );
  });

  it('removes a complete comparison column from the web view and Excel export config', async () => {
    const user = userEvent.setup();
    const multiDateData: LabAnalysisData = {
      ...MOCK_ANALYSIS,
      examDates: ['08/04/2026 14:00', '09/04/2026 09:30'],
      comparison: {
        Hemoglobina: {
          ...MOCK_ANALYSIS.comparison.Hemoglobina,
          '09/04/2026 09:30': {
            section: 'HG',
            analysis: 'Hemoglobina',
            result: '15',
            unit: 'g/dL',
            refValue: '12-16',
          },
        },
      },
    };

    render(<LabViewerComparisonTable data={multiDateData} patient={MOCK_PATIENT} />);

    await user.click(screen.getByTitle('Ocultar columna 08/04/2026 14:00'));

    expect(screen.queryByText('08/04/2026 14:00')).not.toBeInTheDocument();
    expect(screen.queryByText('13')).not.toBeInTheDocument();
    expect(screen.getByText('09/04/2026 09:30')).toBeInTheDocument();

    await user.click(screen.getByText('Exportar Excel'));
    await user.click(screen.getAllByText('Exportar Excel')[1]);

    const [, config] = vi.mocked(exportComparisonToExcel).mock.calls[0];
    expect(config.selectedDates.has('08/04/2026 14:00')).toBe(false);
    expect(config.selectedDates.has('09/04/2026 09:30')).toBe(true);
  });

  it('renders search input', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);
    expect(screen.getByPlaceholderText('Buscar variable…')).toBeInTheDocument();
  });

  it('filters rows when search query entered', async () => {
    const multiVarData: LabAnalysisData = {
      ...MOCK_ANALYSIS,
      comparison: {
        ...MOCK_ANALYSIS.comparison,
        Glucosa: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'Glucosa',
            result: '100',
            unit: 'mg/dL',
            refValue: '70-110',
          },
        },
      },
    };
    render(<LabViewerComparisonTable data={multiVarData} patient={MOCK_PATIENT} />);
    expect(screen.getByText('Hemoglobina')).toBeInTheDocument();
    expect(screen.getByText('Glucosa')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Buscar variable…'), 'Gluc');
    expect(screen.getByText('Glucosa')).toBeInTheDocument();
    expect(screen.queryByText('Hemoglobina')).not.toBeInTheDocument();
  });

  it('renders Exportar Excel button', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);
    expect(screen.getByText('Exportar Excel')).toBeInTheDocument();
  });

  it('does not render summarized copy button anymore', () => {
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);
    expect(screen.queryByText('Copiar tabla resumida')).not.toBeInTheDocument();
  });

  it('groups urine comparison rows under renal function headers', () => {
    const urineData: LabAnalysisData = {
      ...MOCK_ANALYSIS,
      comparison: {
        RPC: {
          '08/04/2026 14:00': {
            section: 'QUIMICA/ORINA',
            analysis: 'RPC',
            result: '136,2',
            unit: '',
            refValue: '< 200,0',
          },
        },
      },
    };

    render(<LabViewerComparisonTable data={urineData} patient={MOCK_PATIENT} />);

    expect(screen.getByText('Función renal / electrolitos')).toBeInTheDocument();
    expect(screen.getByText('RPC')).toBeInTheDocument();
    expect(screen.queryByText('Orina físico-químico')).not.toBeInTheDocument();
    expect(screen.queryByText('Sedimento urinario')).not.toBeInTheDocument();
  });

  it('renders clinical groups expanded by default', () => {
    const groupedData: LabAnalysisData = {
      ...MOCK_ANALYSIS,
      comparison: {
        Hemoglobina: MOCK_ANALYSIS.comparison.Hemoglobina,
        Creatinina: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'Creatinina',
            result: '1.1',
            unit: 'mg/dL',
            refValue: '0.6-1.2',
          },
        },
        'Proteina C Reactiva': {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'Proteina C Reactiva',
            result: '1.2',
            unit: 'mg/L',
            refValue: '0-5',
          },
        },
        'V.H.S.': {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'V.H.S.',
            result: '18',
            unit: 'mm/h',
            refValue: '0-20',
          },
        },
        Calcio: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'Calcio',
            result: '9.0',
            unit: 'mg/dL',
            refValue: '8.4-10.2',
          },
        },
        Fosforo: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'Fosforo',
            result: '3.5',
            unit: 'mg/dL',
            refValue: '2.5-4.5',
          },
        },
        HCO3: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'HCO3',
            result: '22',
            unit: 'mmol/L',
            refValue: '22-29',
          },
        },
        TSH: {
          '08/04/2026 14:00': {
            section: 'BQ',
            analysis: 'TSH',
            result: '2.4',
            unit: 'uUI/mL',
            refValue: '0.4-4.0',
          },
        },
        RAC: {
          '08/04/2026 14:00': {
            section: 'QUIMICA/ORINA',
            analysis: 'RAC',
            result: '238.9',
            unit: '',
            refValue: '< 30.0',
          },
        },
      },
    };

    render(<LabViewerComparisonTable data={groupedData} patient={MOCK_PATIENT} />);

    expect(screen.getByText('Hemograma')).toBeInTheDocument();
    expect(screen.getByText('Función renal / electrolitos')).toBeInTheDocument();
    expect(screen.getByText('Inflamación')).toBeInTheDocument();
    expect(screen.getByText('Metabólico')).toBeInTheDocument();
    expect(screen.getByText('Hemoglobina')).toBeInTheDocument();
    expect(screen.getByText('Creatinina')).toBeInTheDocument();
    expect(screen.getByText('Proteina C Reactiva')).toBeInTheDocument();
    expect(screen.getByText('V.H.S.')).toBeInTheDocument();
    expect(screen.getByText('Calcio')).toBeInTheDocument();
    expect(screen.getByText('Fosforo')).toBeInTheDocument();
    expect(screen.getByText('HCO3')).toBeInTheDocument();
    expect(screen.getByText('RAC')).toBeInTheDocument();
    expect(screen.getByText('TSH')).toBeInTheDocument();
  });

  it('collapses and expands a clinical group', async () => {
    const groupedData: LabAnalysisData = {
      ...MOCK_ANALYSIS,
      comparison: {
        Hemoglobina: MOCK_ANALYSIS.comparison.Hemoglobina,
        Hematocrito: {
          '08/04/2026 14:00': {
            section: 'HG',
            analysis: 'Hematocrito',
            result: '40',
            unit: '%',
            refValue: '36-46',
          },
        },
      },
    };

    render(<LabViewerComparisonTable data={groupedData} patient={MOCK_PATIENT} />);

    expect(screen.getByText('Hemoglobina')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Hemograma/i }));
    expect(screen.queryByText('Hemoglobina')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Hemograma/i }));
    expect(screen.getByText('Hemoglobina')).toBeInTheDocument();
  });

  it('allows pinning and unpinning important variables', async () => {
    const user = userEvent.setup();
    render(<LabViewerComparisonTable data={MOCK_ANALYSIS} patient={MOCK_PATIENT} />);

    const unpinButton = screen.getByTitle('Desanclar Hemoglobina');
    expect(unpinButton).toBeInTheDocument();

    await user.click(unpinButton);
    expect(screen.getByTitle('Anclar Hemoglobina')).toBeInTheDocument();
  });
});
