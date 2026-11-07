import '../../../features/laboratory/labAnalyticsController.testSupport';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalExplorerLabTable } from '@/features/census/components/clinical-explorer/ClinicalExplorerLabTable';
import { buildRecentLabColumns } from '@/features/census/components/clinical-explorer/clinicalExplorerLabModel';
import { buildAnalysisData } from '@/features/laboratory';
import {
  buildDetail,
  buildExam,
  buildFinding,
} from '../../../features/laboratory/labAnalyticsController.testSupport';

vi.mock('@/features/laboratory/report-pdf', () => ({
  default: ({ exam }: { exam: { id: string } }) => <p>PDF original {exam.id}</p>,
}));
const exams = Array.from({ length: 8 }, (_, i) =>
  buildExam({
    id: String(i),
    date: i < 6 ? `0${i + 1}/11/2026` : '07/11/2026',
    time: i === 7 ? '08:00:59' : '08:00:00',
    link: `hhr-syslab-extension://batch/synthetic/exam/${i}`,
  })
);
const analysis = buildAnalysisData(
  exams.map(exam =>
    buildDetail({
      url: exam.link!,
      findings: [
        buildFinding({
          section: 'BIOQUIMICA',
          analysis: 'Creatinina',
          result: `1,${exam.id}`,
          unit: 'mg/dL',
          refValue: '0,7 - 1,2',
        }),
        ...(exam.id === '7'
          ? [
              buildFinding({
                section: 'HEMOGRAMA',
                analysis: 'Hemoglobina',
                result: '12,0',
                unit: 'g/dL',
              }),
            ]
          : []),
      ],
    })
  ),
  exams
);

describe('compact original laboratory reports', () => {
  it('keeps up to ten source identities, newest first, including same-minute reports', () => {
    const columns = buildRecentLabColumns(analysis, exams, '2026-11-07');
    expect(columns.map(column => column.exam?.id)).toEqual([
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    expect(new Set(columns.map(column => column.key)).size).toBe(8);
    expect(
      buildRecentLabColumns(analysis, exams, '2026-11-03').map(column => column.exam?.id)
    ).toEqual(['2', '1', '0']);
  });
  it('shows ten recent reports and excludes older reports beyond that window', () => {
    const manyExams = Array.from({ length: 12 }, (_, i) =>
      buildExam({
        id: String(i),
        date: `${String(i + 1).padStart(2, '0')}/11/2026`,
        time: '08:00:00',
        link: `hhr-syslab-extension://batch/synthetic/exam/${i}`,
      })
    );
    const manyAnalysis = buildAnalysisData(
      manyExams.map(exam =>
        buildDetail({
          url: exam.link!,
          findings: [buildFinding({ analysis: 'Creatinina', result: '1,0', unit: 'mg/dL' })],
        })
      ),
      manyExams
    );
    const columns = buildRecentLabColumns(manyAnalysis, manyExams, '2026-11-12');
    expect(columns.map(column => column.exam?.id)).toEqual([
      '11',
      '10',
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
    ]);
  });
  it('keeps legacy exam order without group headings, shows source hours and does not fill missing measurements', () => {
    render(
      <ClinicalExplorerLabTable
        analysis={analysis}
        exams={exams}
        day="2026-11-07"
        identity="synthetic-a"
      />
    );
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('rowheader')
        .filter(cell => cell.getAttribute('scope') === 'row')
        .map(cell => cell.textContent)
    ).toEqual([expect.stringContaining('Hemoglobina'), expect.stringContaining('Creatinina')]);
    expect(table).toHaveTextContent('08:00');
    expect(table).not.toHaveTextContent('08:00:59');
    expect(table).not.toHaveTextContent('Hemograma');
    expect(table).not.toHaveTextContent('Función renal / electrolitos');
    const haemoglobin = within(table).getByRole('row', { name: /Hemoglobina/ });
    expect(
      within(haemoglobin)
        .getAllByRole('cell')
        .map(cell => cell.textContent)
    ).toEqual(['12,0', '—', '—', '—', '—', '—', '—', '—']);
    expect(table).not.toHaveTextContent('Ref.');
    expect(table.querySelector('[title*="Referencia"]')).toBeNull();
  });
  it('filters names without case or accent sensitivity, clears the query and resets for another identity', () => {
    const props = { analysis, exams, day: '2026-11-07', identity: 'synthetic-a' };
    const view = render(<ClinicalExplorerLabTable {...props} />);
    const search = screen.getByRole('searchbox', { name: 'Buscar examen de laboratorio' });
    fireEvent.change(search, { target: { value: 'CREATINÍNA' } });
    expect(screen.getByRole('table')).toHaveTextContent('Creatinina');
    expect(screen.getByRole('table')).not.toHaveTextContent('Hemoglobina');
    expect(screen.getAllByRole('button', { name: /Abrir PDF/ })).toHaveLength(8);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByRole('status')).toHaveTextContent('Sin exámenes que coincidan');
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda de exámenes' }));
    expect(screen.getByRole('table')).toHaveTextContent('Hemoglobina');
    fireEvent.change(search, { target: { value: 'creatinina' } });
    view.rerender(<ClinicalExplorerLabTable {...props} identity="synthetic-b" />);
    expect(search).toHaveValue('');
    view.rerender(<ClinicalExplorerLabTable {...props} />);
    expect(search).toHaveValue('');
  });

  it('omits reference ranges from rows, cells and tooltips even when they differ', () => {
    const changed = structuredClone(analysis);
    const columns = buildRecentLabColumns(changed, exams, '2026-11-07');
    changed.comparison.Creatinina[columns[1].key].refValue = '0,5 - 1,0';
    render(
      <ClinicalExplorerLabTable
        analysis={changed}
        exams={exams}
        day="2026-11-07"
        identity="synthetic-a"
      />
    );
    const row = screen.getByRole('row', { name: /Creatinina/ });
    expect(within(row).getByRole('rowheader')).not.toHaveTextContent('Ref.');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('1,7');
    expect(cells[1]).toHaveTextContent('1,6');
    expect(row).not.toHaveTextContent(/0,7 - 1,2|0,5 - 1,0/);
    expect(cells[0]).toHaveAttribute('title', '1,7 mg/dL');
  });
  it('opens the PDF of the exact same-minute source, and never reopens it after a patient switch', async () => {
    const view = render(
      <ClinicalExplorerLabTable
        analysis={analysis}
        exams={exams}
        day="2026-11-07"
        identity="synthetic-a"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abrir PDF del informe 6 del 07-11-2026' }));
    await screen.findByText('PDF original 6');
    view.rerender(
      <ClinicalExplorerLabTable
        analysis={analysis}
        exams={exams}
        day="2026-11-07"
        identity="synthetic-b"
      />
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    view.rerender(
      <ClinicalExplorerLabTable
        analysis={analysis}
        exams={exams}
        day="2026-11-07"
        identity="synthetic-a"
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
