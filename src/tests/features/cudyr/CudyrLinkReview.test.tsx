import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CudyrComparisonRows } from '@/features/cudyr/components/CudyrComparisonRows';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import { reportInput } from '../../services/cudyr/reportFixtures';
const item: CudyrComparisonItem = {
  key: 'category:5:2',
  source: 'Eloísa',
  sourceRow: 5,
  sourceDate: '2026-10-02',
  sourceValue: 'C2',
  patientName: 'Paciente Sintético',
  document: 'synthetic-rut',
  status: 'identity_review',
  reason: '',
  candidateKeys: [],
};
const setup = () => {
  const props = {
    data: buildCudyrReport(reportInput()),
    items: [item],
    canReview: true,
    onView: vi.fn(),
  };
  return { props, view: render(<CudyrComparisonRows {...props} />) };
};
const openForm = () => fireEvent.click(screen.getByText('Revisar vínculo · borrador'));
const annotate = () => {
  openForm();
  fireEvent.change(screen.getByLabelText('Motivo y respaldo de la revisión'), {
    target: { value: 'Falta revisar la ficha del episodio.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
};
describe('review drafts within the reconciliation', () => {
  it('validates explicit selection, shows context, and keeps canonical data intact', () => {
    const { props } = setup();
    const before = JSON.stringify(props.data);
    openForm();
    fireEvent.change(screen.getByLabelText('Decisión de revisión'), { target: { value: 'link' } });
    expect(screen.getByLabelText('Episodio HHR a revisar')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Motivo y respaldo de la revisión'), {
      target: { value: 'Identidad y episodio comprobados en la fuente.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Seleccione un episodio');
    fireEvent.change(screen.getByLabelText('Episodio HHR a revisar'), {
      target: { value: 'synthetic-episode' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ver contexto del 2026-10-02' }));
    expect(props.onView).toHaveBeenCalledWith(props.data.rows[0].key);
    fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Confirme');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
    expect(screen.getByText(/1 decisiones en borrador/)).toBeInTheDocument();
    expect(JSON.stringify(props.data)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Retirar decisión' }));
    expect(screen.getByText(/0 decisiones en borrador/)).toBeInTheDocument();
  });
  it('preserves annotated drafts through filters but never counts them as statistical totals', () => {
    setup();
    annotate();
    fireEvent.change(screen.getByLabelText('Revisión manual'), { target: { value: 'unreviewed' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Revisión manual'), { target: { value: 'pending' } });
    expect(
      within(screen.getByRole('article')).getByText('Pendiente con observación · borrador')
    ).toBeInTheDocument();
  });
  it('invalidates decisions and unfinished form values when the read or sources change', () => {
    const { props, view } = setup();
    annotate();
    view.rerender(<CudyrComparisonRows {...props} data={{ ...props.data }} />);
    expect(screen.getByText(/0 decisiones en borrador/)).toBeInTheDocument();
    openForm();
    expect(screen.getByLabelText('Motivo y respaldo de la revisión')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Motivo y respaldo de la revisión'), {
      target: { value: 'Nueva observación sobre la fuente.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
    view.rerender(<CudyrComparisonRows {...props} items={[{ ...item, sourceValue: 'C3' }]} />);
    expect(screen.getByText(/0 decisiones en borrador/)).toBeInTheDocument();
  });
  it('removes drafts on loss of permission and does not resurrect them on return', () => {
    const { props, view } = setup();
    annotate();
    view.rerender(<CudyrComparisonRows {...props} canReview={false} />);
    expect(screen.queryByText('Revisión manual')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Anotar decisión en borrador' })
    ).not.toBeInTheDocument();
    view.rerender(<CudyrComparisonRows {...props} />);
    expect(screen.getByText(/0 decisiones en borrador/)).toBeInTheDocument();
  });
});
