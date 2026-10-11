import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CudyrCensusApprovalButton } from '@/features/cudyr/components/CudyrCensusApprovalButton';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  load: vi.fn(),
  approve: vi.fn(),
}));
vi.mock('@/services/cudyr/cudyrCensusApproval', () => ({
  prepareCudyrCensusApproval: mocks.prepare,
}));
vi.mock('@/services/cudyr/cudyrVerifiedContextService', () => ({
  loadCudyrVerifiedContexts: mocks.load,
  approveCudyrReconstructedCensus: mocks.approve,
}));
const data = { from: '2026-08-01', to: '2026-08-31' } as CudyrReportDataset;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue([{ date: '2026-08-01', fingerprint: 'synthetic' }]);
  mocks.load.mockResolvedValue([{ month: '2026-08', revision: 4 }]);
  mocks.approve.mockResolvedValue({ persisted: true, revision: 5 });
});
it('requires explicit confirmation and submits the prepared revision with a reason', async () => {
  const onApproved = vi.fn();
  render(<CudyrCensusApprovalButton data={data} onApproved={onApproved} />);
  expect(mocks.approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar censo reconstruido' }));
  expect(mocks.approve).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Motivo del cierre'), {
    target: { value: 'Cotejo documental sintético completado.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre oficial' }));
  await waitFor(() => expect(onApproved).toHaveBeenCalledOnce());
  expect(mocks.approve).toHaveBeenCalledWith(
    expect.objectContaining({
      month: '2026-08',
      expectedRevision: 4,
      reason: 'Cotejo documental sintético completado.',
      days: [{ date: '2026-08-01', fingerprint: 'synthetic' }],
    })
  );
});
it('preserves the form and reports failed publication without claiming approval', async () => {
  mocks.approve.mockRejectedValue(new Error('La conciliación cambió'));
  const onApproved = vi.fn();
  render(<CudyrCensusApprovalButton data={data} onApproved={onApproved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar censo reconstruido' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre oficial' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La conciliación cambió');
  expect(onApproved).not.toHaveBeenCalled();
});

it('does not publish after the approval view is closed during preparation', async () => {
  let resolve!: (days: unknown[]) => void;
  mocks.prepare.mockReturnValue(
    new Promise(done => {
      resolve = done;
    })
  );
  const onApproved = vi.fn();
  const view = render(<CudyrCensusApprovalButton data={data} onApproved={onApproved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar censo reconstruido' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre oficial' }));
  view.unmount();
  resolve([]);
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(onApproved).not.toHaveBeenCalled();
});
