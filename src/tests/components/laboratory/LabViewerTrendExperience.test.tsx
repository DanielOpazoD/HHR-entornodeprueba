import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockExportChartsAsPng = vi.hoisted(() => vi.fn());
const mockLineChartProps = vi.hoisted(() => vi.fn());

vi.mock('@/features/laboratory/controllers/labSummaryController', () => ({
  buildLabSummaryText: vi.fn(() => 'mock summary'),
}));

vi.mock('@/features/laboratory/components/labTrendChartExport', () => ({
  exportChartsAsPng: (...args: unknown[]) => mockExportChartsAsPng(...args),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: (props: { children: React.ReactNode; syncId?: string; syncMethod?: string }) => {
    mockLineChartProps(props);
    return <div data-testid="line-chart">{props.children}</div>;
  },
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceArea: () => null,
}));

import { LabViewerAnalysis } from '@/features/laboratory/components/LabViewerAnalysis';
import { LabViewerTrendCharts } from '@/features/laboratory/components/LabViewerTrendCharts';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { LabPatient } from '@/types/domain/labExamTypes';

const PATIENT: LabPatient = {
  bedId: 'R1',
  label: 'R1 · Paciente de prueba',
  patientName: 'Paciente de prueba',
  rut: '11111111-1',
  birthDate: '1980-01-01',
};

const TREND_DATA: LabAnalysisData = {
  trendGroups: [
    {
      label: 'Hemograma',
      variables: {
        Hemoglobina: [
          {
            date: '01/04/2026',
            isoDate: '2026-04-01',
            value: 13,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
          {
            date: '02/04/2026',
            isoDate: '2026-04-02',
            value: 17,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
        ],
      },
    },
  ],
  examDates: ['01/04/2026', '02/04/2026'],
  comparison: {},
  microbiologyEntries: [],
};

describe('LabViewerTrendCharts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters trend variables and can restore the full view', async () => {
    render(<LabViewerTrendCharts data={TREND_DATA} />);

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar variable de laboratorio' }),
      'creatinina'
    );

    expect(screen.getByText('No hay tendencias para estos filtros.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }));
    expect(screen.getByText('Hemograma')).toBeInTheDocument();
  });

  it('keeps each detail tooltip scoped to the chart being inspected', () => {
    render(<LabViewerTrendCharts data={TREND_DATA} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockLineChartProps).toHaveBeenCalled();
    expect(mockLineChartProps.mock.calls[0][0]).not.toHaveProperty('syncId');
    expect(mockLineChartProps.mock.calls[0][0]).not.toHaveProperty('syncMethod');
  });

  it('groups PNG export with the patient actions and reports failures locally', async () => {
    mockExportChartsAsPng.mockRejectedValue(new Error('tainted canvas'));

    render(
      <LabViewerAnalysis
        data={TREND_DATA}
        patient={PATIENT}
        activeTab="trends"
        onTabChange={vi.fn()}
        onBack={vi.fn()}
        onOpenPdf={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Descargar PNG' }));

    expect(await screen.findByText('No se pudo descargar PNG.')).toBeInTheDocument();
    expect(mockExportChartsAsPng).toHaveBeenCalledTimes(1);
  });

  it('explains why PNG export is unavailable when there are no charts', async () => {
    render(
      <LabViewerAnalysis
        data={{ ...TREND_DATA, trendGroups: [] }}
        patient={PATIENT}
        activeTab="trends"
        onTabChange={vi.fn()}
        onBack={vi.fn()}
        onOpenPdf={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Descargar PNG' }));

    expect(screen.getByRole('alert')).toHaveTextContent('No hay gráficos visibles para descargar.');
    expect(mockExportChartsAsPng).not.toHaveBeenCalled();
  });
});
