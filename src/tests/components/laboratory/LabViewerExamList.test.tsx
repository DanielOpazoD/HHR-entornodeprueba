import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LabViewerExamList } from '@/features/laboratory/components/LabViewerExamList';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

const MOCK_EXAM: SyslabExamItem = {
  id: '123',
  link: 'http://test/exam',
  date: '08/04/2026',
  time: '14:00:00',
  patientName: 'Test',
  origin: 'HOSP',
  exams: ['HEMOGRAMA'],
};

describe('LabViewerExamList', () => {
  const defaultProps = {
    exams: [MOCK_EXAM],
    selectedIds: new Set<string>(),
    filterCategories: [] as string[],
    activeFilter: null as string | null,
    onFilterChange: vi.fn(),
    onToggleSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectByDays: vi.fn(),
    onSelectByDateRange: vi.fn(),
    onViewPdf: vi.fn(),
    onCopySummary: vi.fn(async () => true),
    isDownloadingSelectedPdfs: false,
    pdfDownloadStatus: null,
    onDownloadSelectedPdfs: vi.fn(async () => undefined),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders exam count inline beside the available orders label', () => {
    render(<LabViewerExamList {...defaultProps} />);
    const heading = screen.getByText('Ordenes disponibles').closest('div');
    expect(heading).toHaveTextContent('Ordenes disponibles');
    expect(heading).toHaveTextContent('1');
    expect(screen.queryByText('1 examenes')).not.toBeInTheDocument();
  });

  it('downloads the selected exams as one PDF from the first list action', async () => {
    render(<LabViewerExamList {...defaultProps} selectedIds={new Set(['123'])} />);

    const button = screen.getByRole('button', {
      name: 'Descargar exámenes seleccionados en un único PDF',
    });
    expect(button).toHaveTextContent('Descargar selección');
    expect(button).toHaveTextContent('1');
    await userEvent.click(button);
    expect(defaultProps.onDownloadSelectedPdfs).toHaveBeenCalledTimes(1);
  });

  it('disables the combined PDF action when no exam is selected', () => {
    render(<LabViewerExamList {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: 'Descargar exámenes seleccionados en un único PDF' })
    ).toBeDisabled();
  });

  it('shows real progress and the final PDF confirmation', () => {
    const { rerender } = render(
      <LabViewerExamList
        {...defaultProps}
        selectedIds={new Set(['123'])}
        pdfDownloadStatus={{
          phase: 'validating',
          completed: 0,
          total: 1,
          pageCount: 0,
        }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Validando informe 1 de 1');

    rerender(
      <LabViewerExamList
        {...defaultProps}
        selectedIds={new Set(['123'])}
        pdfDownloadStatus={{
          phase: 'success',
          completed: 1,
          total: 1,
          pageCount: 3,
          filename: 'Laboratorio HHR 08-04-2026, Test, 14.125.562-2.pdf',
        }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'PDF creado correctamente · 1 informe · 3 páginas'
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Laboratorio HHR 08-04-2026, Test, 14.125.562-2.pdf'
    );
  });

  it('explains a successful download completed by the previous extension version', () => {
    render(
      <LabViewerExamList
        {...defaultProps}
        selectedIds={new Set(['123'])}
        pdfDownloadStatus={{
          phase: 'success',
          completed: 1,
          total: 1,
          pageCount: 0,
          filename: 'Examenes_Syslab_seleccionados.pdf',
          legacyExtension: true,
        }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'PDF descargado · 1 informe. Recarga la extensión Eloísa'
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('0 páginas');
    expect(screen.getByRole('status')).not.toHaveTextContent('Examenes_Syslab_seleccionados.pdf');
  });

  it('renders extended monthly quick range buttons', async () => {
    const { container } = render(<LabViewerExamList {...defaultProps} />);
    const rangeGroup = container.querySelector('[data-testid="lab-quick-range-group"]');

    expect(rangeGroup).toHaveClass('inline-flex');
    expect(rangeGroup).toHaveClass('overflow-hidden');
    expect(rangeGroup).toHaveClass('rounded-lg');
    expect(screen.getByRole('button', { name: '1 mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 meses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 meses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12 meses' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '3 meses' }));
    expect(defaultProps.onSelectByDays).toHaveBeenCalledWith(90);
  });

  it('renders exam name tags in a smaller visual treatment', () => {
    const { container } = render(<LabViewerExamList {...defaultProps} />);
    const tag = Array.from(container.querySelectorAll('span')).find(
      element => element.textContent === 'HEMOGRAMA'
    );

    expect(tag).toHaveClass('text-[9px]');
    expect(tag).toHaveClass('bg-slate-50');
    expect(tag).toHaveClass('text-slate-600');
  });

  it('keeps order cards row-like and copy action visually secondary', () => {
    const { container } = render(<LabViewerExamList {...defaultProps} />);
    const card = container.querySelector('[data-testid="lab-exam-card-123"]');
    const copyButton = screen.getByRole('button', { name: 'Copiar resumen del examen 123' });

    expect(card).toHaveClass('rounded-md');
    expect(card).toHaveClass('bg-white');
    expect(copyButton).toHaveClass('border-transparent');
    expect(copyButton).toHaveClass('bg-transparent');
    expect(copyButton).toHaveClass('text-slate-500');
  });

  it('uses a sober selected state with an emerald checkbox instead of blue native selection', () => {
    const { container } = render(
      <LabViewerExamList {...defaultProps} selectedIds={new Set(['123'])} />
    );
    const card = container.querySelector('[data-testid="lab-exam-card-123"]');
    const checkbox = screen.getByRole('checkbox');

    expect(card).toHaveClass('bg-white');
    expect(card).not.toHaveClass('bg-emerald-50/30');
    expect(checkbox.tagName).toBe('BUTTON');
    expect(checkbox).toHaveClass('bg-emerald-600');
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('renders exam date and ID', () => {
    render(<LabViewerExamList {...defaultProps} />);
    expect(screen.getByText('08/04/2026')).toBeInTheDocument();
    expect(screen.getByText('#123')).toBeInTheDocument();
  });

  it('renders Ver PDF button', () => {
    render(<LabViewerExamList {...defaultProps} />);
    expect(screen.getByText('Ver PDF')).toBeInTheDocument();
  });

  it('renders Copiar resumen button', () => {
    render(<LabViewerExamList {...defaultProps} />);
    expect(screen.getByText('Copiar resumen')).toBeInTheDocument();
  });

  it('does not render exam category filter chips in the initial order list', () => {
    render(
      <LabViewerExamList
        {...defaultProps}
        filterCategories={['Hemograma', 'P. hepático', 'P. lipídico']}
      />
    );
    expect(screen.queryByRole('button', { name: 'Todos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hemograma' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'P. hepático' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'P. lipídico' })).not.toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    const { container } = render(<LabViewerExamList {...defaultProps} />);
    const dateInputs = container.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it('calls onToggleSelect when checkbox clicked', async () => {
    render(<LabViewerExamList {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox');
    await userEvent.click(checkbox);
    expect(defaultProps.onToggleSelect).toHaveBeenCalledWith('123');
  });

  it('calls onViewPdf when Ver PDF clicked', async () => {
    render(<LabViewerExamList {...defaultProps} />);
    await userEvent.click(screen.getByText('Ver PDF'));
    expect(defaultProps.onViewPdf).toHaveBeenCalledWith(MOCK_EXAM);
  });

  it('calls onCopySummary when Copiar resumen clicked', async () => {
    render(<LabViewerExamList {...defaultProps} />);
    await userEvent.click(screen.getByText('Copiar resumen'));
    expect(defaultProps.onCopySummary).toHaveBeenCalledWith(MOCK_EXAM);
  });
});
