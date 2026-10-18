import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CudyrMonthlyRecovery } from '@/features/cudyr/components/CudyrMonthlyRecovery';
const recover = vi.hoisted(() => vi.fn());
const clock = vi.hoisted(() => ({ closed: true }));
vi.mock('@/services/cudyr/cudyrMonthlyRecovery', () => ({
  monthlyRecoveryWindow: () => (clock.closed ? { last: '2026-08-31', next: '2026-09-01' } : null),
  recoverCudyrMonthlyReports: recover,
}));
vi.mock('@/domain/cudyr/cudyrPending', () => ({
  resolveCudyrPendingStatus: () => ({ phase: clock.closed ? 'overdue' : 'application_window' }),
}));
beforeEach(() => {
  recover.mockReset();
  clock.closed = true;
});
describe('explicit monthly documentary action', () => {
  it('enables the action when the first night closes without navigation or source queries', () => {
    vi.useFakeTimers();
    clock.closed = false;
    const view = render(<CudyrMonthlyRecovery month="2026-08" onSaved={vi.fn()} />);
    try {
      expect(screen.getByText('Actualizar CUDYR')).toBeDisabled();
      clock.closed = true;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('Actualizar CUDYR')).toBeEnabled();
      expect(recover).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it('serializes stop/restart while an in-flight save is settling', async () => {
    let finish: (value: unknown) => void = () => {};
    recover.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    render(<CudyrMonthlyRecovery month="2026-08" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText('Actualizar CUDYR'));
    fireEvent.click(screen.getByText('Detener'));
    expect(screen.getByText('Recuperando…')).toBeDisabled();
    fireEvent.click(screen.getByText('Recuperando…'));
    expect(recover).toHaveBeenCalledTimes(1);
    finish({ recovered: 1, reused: 0, failures: [] });
    await waitFor(() => expect(screen.getByText('Actualizar CUDYR')).toBeEnabled());
  });
  it('does not synchronize when opening and makes the incomplete scope visible', () => {
    render(<CudyrMonthlyRecovery month="2026-08" onSaved={vi.fn()} />);
    expect(recover).not.toHaveBeenCalled();
    expect(screen.getByText(/Autor y hora se conservan cuando existen/)).toBeInTheDocument();
  });
  it('shows reuse and pending states without declaring the month verified', async () => {
    const saved = vi.fn();
    recover.mockResolvedValue({
      recovered: 1,
      reused: 1,
      failures: [],
      verification: 'documentary',
    });
    render(<CudyrMonthlyRecovery month="2026-08" onSaved={saved} />);
    fireEvent.click(screen.getByText('Actualizar CUDYR'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(screen.getByText(/1 informes guardados · 1 reutilizados/)).toHaveTextContent(
      'Resultados y elegibilidad se informan por separado.'
    );
  });
  it('shows the source failure reason so a retry can address its cause', async () => {
    recover.mockImplementation(async (_month, _signal, progress) => {
      progress({
        reportMonth: '2026-10',
        status: 'failed',
        detail: 'Conecta Gestión de Camas para recuperar el mes.',
      });
      return { recovered: 0, reused: 0, failures: ['2026-10'] };
    });
    render(<CudyrMonthlyRecovery month="2026-10" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText('Actualizar CUDYR'));
    await waitFor(() => expect(screen.getByText(/Conecta Gestión de Camas/)).toBeInTheDocument());
    expect(screen.getByText(/1 consultas pendientes/)).toBeInTheDocument();
  });
  it('aborts on unmount and never refreshes another screen after an in-flight read', async () => {
    let finish: (value: unknown) => void = () => {};
    recover.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const saved = vi.fn();
    const view = render(<CudyrMonthlyRecovery month="2026-08" onSaved={saved} />);
    fireEvent.click(screen.getByText('Actualizar CUDYR'));
    const signal = recover.mock.calls[0][1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    finish({ recovered: 1, reused: 0, failures: [] });
    await Promise.resolve();
    expect(saved).not.toHaveBeenCalled();
  });
});
