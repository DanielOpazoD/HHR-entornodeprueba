import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockExportChartsAsPng = vi.hoisted(() => vi.fn());

vi.mock('@/features/laboratory/controllers/labSummaryController', () => ({
  buildLabSummaryText: vi.fn(() => 'mock summary'),
}));

vi.mock('@/features/laboratory/components/labTrendChartExport', () => ({
  exportChartsAsPng: (...args: unknown[]) => mockExportChartsAsPng(...args),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({
    children,
    onMouseMove,
  }: {
    children: React.ReactNode;
    onMouseMove?: (state: { activeLabel: string }) => void;
  }) => (
    <div data-testid="line-chart" onMouseMove={() => onMouseMove?.({ activeLabel: '02/04/2026' })}>
      {children}
    </div>
  ),
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

  it('shows every plotted result for the synchronized cursor date', async () => {
    render(<LabViewerTrendCharts data={TREND_DATA} />);

    await userEvent.hover(screen.getByTestId('line-chart'));

    expect(
      screen.getByRole('status', { name: /resultados graficados del 02\/04\/2026/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Alto')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('labels results without reference bounds as unknown instead of normal', async () => {
    const dataWithoutReference: LabAnalysisData = {
      ...TREND_DATA,
      trendGroups: [
        {
          label: 'Marcadores',
          variables: {
            'CK Total': [
              {
                date: '02/04/2026',
                isoDate: '2026-04-02',
                value: 120,
                unit: 'U/L',
              },
            ],
          },
        },
      ],
    };

    render(<LabViewerTrendCharts data={dataWithoutReference} />);
    await userEvent.hover(screen.getByTestId('line-chart'));

    expect(screen.getByText('Sin referencia')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
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
