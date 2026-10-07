import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CudyrReviewWorkspace } from '@/features/cudyr/components/CudyrReviewWorkspace';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReviewSource, SavedCudyrReview } from '@/types/domain/cudyrReview';
import { reportInput } from '../../services/cudyr/reportFixtures';
const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/cudyr/cudyrReviewService', () => ({
  loadCudyrReviews: api.load,
  saveCudyrReview: api.save,
}));
const item: CudyrComparisonItem = {
  key: 'category:5:2',
  source: 'Eloísa',
  sourceRow: 5,
  sourceDate: '2026-10-02',
  sourceValue: 'C2',
  patientName: 'Paciente sintético',
  document: 'synthetic-rut',
  status: 'identity_review',
  reason: 'Documento compartido',
  candidateKeys: [],
};
const sources: CudyrReviewSource[] = [
  { kind: 'categories', name: 'sintetico.xls', sha256: 'a'.repeat(64) },
];
const props = () => ({
  data: buildCudyrReport(reportInput()),
  items: [item],
  sources,
  canReview: true,
  onView: vi.fn(),
});
const annotate = () => {
  fireEvent.click(screen.getByText('Revisar vínculo · borrador'));
  fireEvent.change(screen.getByLabelText('Motivo y respaldo de la revisión'), {
    target: { value: 'Revisar la ficha original de julio.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anotar decisión en borrador' }));
};
describe('resume monthly review without modifying clinical data', () => {
  let stored: SavedCudyrReview[];
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    stored = [];
    vi.clearAllMocks();
    api.load.mockImplementation(async () => structuredClone(stored));
    api.save.mockImplementation(async request => {
      const review = {
        ...request,
        id: 'a'.repeat(64),
        revision: request.expectedRevision + 1,
        schemaVersion: 1,
        verification: 'user_review',
        updatedAt: '2026-10-07T20:00:00Z',
        reviewedBy: {
          uid: 'reviewer',
          name: 'Revisor sintético',
          email: 'test@example.com',
          role: 'admin',
        },
      };
      stored = [review];
      return { persisted: true, review };
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('saves explicitly, restores after leaving, and invalidates changed daily modality or source', async () => {
    const input = props(),
      before = JSON.stringify(input.data);
    let view = render(<CudyrReviewWorkspace {...input} />);
    await screen.findByText(/1 pendientes · 0 revisados/);
    annotate();
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar revisión en HHR' }));
    await screen.findByText(/Revisión guardada/);
    expect(JSON.stringify(input.data)).toBe(before);
    expect(screen.getByText(/Revisor: Revisor sintético/)).toBeInTheDocument();
    view.unmount();
    const refreshed = { ...input, data: { ...input.data, generatedAt: '2026-10-08T20:00:00Z' } };
    view = render(<CudyrReviewWorkspace {...refreshed} />);
    await screen.findByText(/Revisión guardada/);
    const changed = structuredClone(refreshed.data);
    changed.rows[0].modality = 'cuna';
    view.rerender(<CudyrReviewWorkspace {...refreshed} data={changed} />);
    await screen.findByText(/Requiere nueva revisión/);
    view.rerender(
      <CudyrReviewWorkspace {...refreshed} sources={[{ ...sources[0], sha256: 'b'.repeat(64) }]} />
    );
    await screen.findByText(/Requiere nueva revisión/);
    expect(api.save).toHaveBeenCalledTimes(1);
    view.rerender(<CudyrReviewWorkspace {...refreshed} items={[]} sources={[]} />);
    await screen.findByText(/1 decisiones guardadas fuera/);
  });
  it('keeps drafts and requires reload when a save fails or conflicts', async () => {
    api.save.mockRejectedValue(new Error('aborted'));
    render(<CudyrReviewWorkspace {...props()} />);
    await screen.findByText(/1 pendientes/);
    annotate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar revisión en HHR' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Guardar revisión en HHR' })).toBeDisabled();
    expect(screen.getByText(/Decisión anotada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recargar revisiones guardadas' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Guardar revisión en HHR' })).toBeEnabled()
    );
  });
  it('reconciles a committed save after a lost response without creating another revision', async () => {
    const commit = api.save.getMockImplementation()!;
    api.save.mockImplementation(async request => {
      await commit(request);
      throw new Error('response lost');
    });
    render(<CudyrReviewWorkspace {...props()} />);
    await screen.findByText(/1 pendientes/);
    annotate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar revisión en HHR' }));
    await screen.findByRole('alert');
    expect(stored[0].revision).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recargar revisiones guardadas' }));
    await screen.findByText(/Revisión guardada/);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Guardar revisión en HHR' })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText(/0 decisiones en borrador/)).toBeInTheDocument();
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it('allows authorized readers to see saved decisions and history without editing controls', async () => {
    const input = props();
    const view = render(<CudyrReviewWorkspace {...input} />);
    await screen.findByText(/1 pendientes/);
    annotate();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar revisión en HHR' }));
    await screen.findByText(/Revisión guardada/);
    view.rerender(<CudyrReviewWorkspace {...input} canReview={false} />);
    await screen.findByText(/Revisión guardada/);
    expect(screen.getByText('Historial de revisiones')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decisión de revisión')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Guardar revisión en HHR' })
    ).not.toBeInTheDocument();
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it('does not display late reads after permission loss', async () => {
    let resolve!: (value: SavedCudyrReview[]) => void;
    api.load.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    const input = props();
    const view = render(<CudyrReviewWorkspace {...input} />);
    view.rerender(<CudyrReviewWorkspace {...input} canReview={false} canRead={false} />);
    resolve([]);
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Revisión mensual guardada' })
      ).not.toBeInTheDocument()
    );
    expect(api.save).not.toHaveBeenCalled();
  });
});
