import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CudyrMonthlyReconciliation } from '@/features/cudyr/components/CudyrMonthlyReconciliation';
import { readCudyrReconciliationFile } from '@/services/cudyr/cudyrReconciliationFile';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../../services/cudyr/reportFixtures';
vi.mock('@/services/cudyr/cudyrReconciliationFile', () => ({
  readCudyrReconciliationFile: vi.fn(),
}));
// These tests own file/period lifecycle. Persistence is covered by CudyrReviewPersistence.test.tsx.
vi.mock('@/features/cudyr/components/CudyrReviewWorkspace', () => ({
  CudyrReviewWorkspace: () => <div data-testid="review-workspace" />,
}));
const renderPanel = () =>
  render(
    <CudyrMonthlyReconciliation
      data={buildCudyrReport(reportInput())}
      reports={[]}
      ready
      onView={vi.fn()}
    />
  );
describe('monthly preview lifecycle', () => {
  it('never mounts the persistence workspace for a range spanning months', () => {
    const data = buildCudyrReport(reportInput());
    render(
      <CudyrMonthlyReconciliation
        data={{ ...data, to: '2026-11-01' }}
        reports={[]}
        ready
        canReview
        onView={vi.fn()}
      />
    );
    expect(
      screen.getByText('Consulte un solo mes para comparar informes históricos.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('review-workspace')).not.toBeInTheDocument();
  });

  it('is closed by default and has no save or apply action', () => {
    renderPanel();
    expect(screen.getByTestId('cudyr-monthly-reconciliation')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: /guardar|aplicar/i })).not.toBeInTheDocument();
  });
  it('rejects an incomplete discharge period without showing a partial comparison', async () => {
    vi.mocked(readCudyrReconciliationFile).mockResolvedValueOnce({
      name: 'synthetic.xls',
      sha256: 'synthetic',
      kind: 'discharges',
      report: { from: '2026-10-03', to: '2026-10-04', generatedLabel: '', rows: [] },
    });
    renderPanel();
    fireEvent.click(screen.getByText('Conciliar histórico · revisión complementaria'));
    fireEvent.change(screen.getByLabelText('Altas administrativas locales'), {
      target: { files: [new File(['fixture'], 'synthetic.xls')] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('debe cubrir todo el período');
    expect(screen.queryByText('synthetic.xls')).not.toBeInTheDocument();
  });
  it('aborts pending local reads on period/session unmount', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(readCudyrReconciliationFile).mockImplementationOnce((_file, _kind, abort) => {
      signal = abort;
      return new Promise(() => {});
    });
    const view = renderPanel();
    fireEvent.change(screen.getByLabelText('Categorización Eloísa local'), {
      target: { files: [new File(['fixture'], 'synthetic.xls')] },
    });
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
