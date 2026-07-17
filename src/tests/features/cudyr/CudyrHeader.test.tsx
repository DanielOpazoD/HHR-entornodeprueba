import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

import { CudyrHeader } from '@/features/cudyr/components/CudyrHeader';

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span>Back</span>,
  FileSpreadsheet: () => <span>XLSX</span>,
  FileText: () => <span>PDF</span>,
  Loader2: () => <span>Loading</span>,
  RotateCcw: () => <span>Undo</span>,
  Save: () => <span>Save</span>,
  X: () => <span>Close</span>,
}));

describe('CudyrHeader', () => {
  it('renders the title with formatted date', () => {
    render(<CudyrHeader occupiedCount={10} categorizedCount={8} currentDate="2026-03-07" />);

    expect(screen.getByText('Instrumento CUDYR')).toBeInTheDocument();
    expect(screen.getByText(/Turno noche 07-03-2026/)).toBeInTheDocument();
  });

  it('uses explicit monthly export wording tied to the current cutoff date', () => {
    render(<CudyrHeader occupiedCount={10} categorizedCount={8} currentDate="2026-03-07" />);

    expect(screen.getByRole('button', { name: /excel mensual/i })).toHaveAttribute(
      'title',
      'Exportar resumen mensual CUDYR'
    );
  });

  it('keeps instrument and Excel actions beside the title with compact neutral styling', () => {
    render(<CudyrHeader occupiedCount={10} categorizedCount={8} currentDate="2026-03-07" />);

    const titleRow = screen.getByTestId('cudyr-title-row');
    const statsBar = screen.getByTestId('cudyr-stats-actions-bar');
    const instrumentButton = within(titleRow).getByRole('button', { name: /ver instrumento/i });
    const excelButton = within(titleRow).getByRole('button', { name: /excel mensual/i });

    expect(instrumentButton).toHaveClass('text-[10px]', 'text-slate-600', 'bg-white');
    expect(excelButton).toHaveClass('text-[10px]', 'text-slate-600', 'bg-white');
    expect(instrumentButton).not.toHaveClass('text-sky-700', 'bg-sky-50');
    expect(excelButton).not.toHaveClass('bg-emerald-600', 'text-white');
    expect(within(statsBar).queryByRole('button', { name: /ver instrumento/i })).toBeNull();
    expect(within(statsBar).queryByRole('button', { name: /excel mensual/i })).toBeNull();
  });

  it('opens the instrument pdf from the header', () => {
    render(<CudyrHeader occupiedCount={10} categorizedCount={8} currentDate="2026-03-07" />);

    fireEvent.click(screen.getByRole('button', { name: /ver instrumento/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTitle('Instrumento CUDYR')).toHaveAttribute(
      'src',
      '/docs/instrumento-cudyr.pdf#toolbar=0'
    );
  });

  it('shows the latest CUDYR modification time when available', () => {
    render(
      <CudyrHeader
        occupiedCount={10}
        categorizedCount={8}
        currentDate="2026-03-07"
        updatedAt="2026-03-07T14:35:00"
      />
    );

    expect(screen.getByText(/últ\. mod\./i)).toHaveTextContent('Últ. mod. 14:35');
  });

  it('renders the back-to-night-shift button prominently', () => {
    render(<CudyrHeader occupiedCount={10} categorizedCount={8} currentDate="2026-03-07" />);

    const backBtn = screen.getByRole('button', { name: /volver a turno noche/i });
    expect(backBtn).toBeInTheDocument();
  });

  it('shows occupancy metrics in the stats bar', () => {
    render(<CudyrHeader occupiedCount={13} categorizedCount={10} currentDate="2026-03-07" />);

    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('77%')).toBeInTheDocument();
  });

  it('keeps header controls wrapped and bounded for narrow clinical workspaces', () => {
    render(<CudyrHeader occupiedCount={13} categorizedCount={10} currentDate="2026-03-07" />);

    expect(screen.getByTestId('cudyr-title-row')).toHaveClass('flex-wrap');
    expect(screen.getByTestId('cudyr-stats-actions-bar')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('cudyr-metrics')).toHaveClass('min-w-0', 'flex-wrap');
    expect(screen.getByTestId('cudyr-actions')).toHaveClass('flex-wrap', 'justify-end');
  });

  it('keeps pending CUDYR save controls out of the header metrics area', () => {
    render(<CudyrHeader occupiedCount={13} categorizedCount={10} currentDate="2026-03-07" />);

    expect(screen.queryByTestId('cudyr-pending-save-row')).toBeNull();
    expect(screen.queryByRole('button', { name: /guardar cudyr/i })).toBeNull();
  });

  it('shows only non-zero category pills when counts are provided', () => {
    const counts = {
      uti: { A1: 1, A2: 0, A3: 0, B1: 0, B2: 2, B3: 0, C1: 0, C2: 0, C3: 0, D1: 0, D2: 0, D3: 0 },
      media: { A1: 0, A2: 0, A3: 0, B1: 0, B2: 0, B3: 0, C1: 1, C2: 0, C3: 0, D1: 0, D2: 0, D3: 0 },
    };

    render(
      <CudyrHeader
        occupiedCount={4}
        categorizedCount={4}
        currentDate="2026-03-07"
        categoryCounts={counts}
      />
    );

    // A1 (uti:1) and B2 (uti:2) and C1 (media:1) should appear
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('C1')).toBeInTheDocument();
    // D1 has 0, should not appear as a pill
    expect(screen.queryByText('D1')).not.toBeInTheDocument();
  });
});
