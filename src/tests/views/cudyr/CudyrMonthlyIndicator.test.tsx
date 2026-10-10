import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CudyrMonthlyIndicator } from '@/features/cudyr/components/CudyrMonthlyIndicator';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from '../../services/cudyr/reportFixtures';
import { loadCudyrReport } from '@/services/cudyr/cudyrReportLoader';
const session = vi.hoisted(() => ({ owner: 'owner-a', generation: 'a' }));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => session.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => session.generation,
}));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: null, bootstrapPhase: 'confirmed_empty' }),
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const dataset = (from: string, to: string, count: number, categorized: number) => {
  const data = buildCudyrReport(confirmedReportInput());
  const date = from.startsWith('2026-10') ? '2026-10-08' : from.slice(0, 7) + '-28';
  const row = { ...data.rows[0], date, applicationPending: false };
  return {
    ...data,
    from,
    to,
    generatedAt: '2026-10-10T20:00:00Z',
    rows: Array.from({ length: count }, (_, index) => ({
      ...row,
      key: `synthetic-${index}`,
      ...(index >= categorized
        ? { cudyrStatus: 'sin_registro_observado' as const, evaluation: null }
        : {}),
    })),
    coverage: [{ date, state: 'disponible' as const, lastSyncedAt: '', runId: '' }],
  };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T20:00:00Z'));
  session.generation += 'a';
  sessionStorage.clear();
  vi.mocked(loadCudyrReport)
    .mockReset()
    .mockImplementation(async (from, to) =>
      from.startsWith('2026-08')
        ? dataset(from, to, 10, 8)
        : from.startsWith('2026-09')
          ? dataset(from, to, 10, 9)
          : dataset(from, to, 100, 50)
    );
});
afterEach(() => vi.useRealTimers());
describe('Interactive census CUDYR card', () => {
  it('navigates cleaned months without repeating loaded reads and shows a weighted annual rate', async () => {
    render(<CudyrMonthlyIndicator date="2026-10-10" />);
    await waitFor(() => expect(screen.getByText(/Acum\. 2026/)).toHaveTextContent('56%'));
    expect(screen.getByText('50/100 elegibles')).toBeVisible();
    expect(screen.getByText(/Acum\. 2026/)).toHaveTextContent('desde ago.');
    expect(screen.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();
    expect(loadCudyrReport).toHaveBeenCalledTimes(3);
    expect(vi.mocked(loadCudyrReport).mock.calls.map(call => call[1])).toEqual(
      expect.arrayContaining(['2026-08-31', '2026-09-30', '2026-10-09'])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByText('9/10 elegibles')).toBeVisible();
    expect(screen.getByText(/Acum\. 2026/)).toHaveTextContent('85%');
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByText('8/10 elegibles')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Mes de CUDYR' }), {
      target: { value: '2026-10' },
    });
    expect(screen.getByText('50/100 elegibles')).toBeVisible();
    expect(loadCudyrReport).toHaveBeenCalledTimes(3);
  });
  it('does not publish an annual percentage when a monthly read fails', async () => {
    vi.mocked(loadCudyrReport).mockImplementation(async (from, to) => {
      if (from.startsWith('2026-09')) throw new Error('No se pudo leer');
      return dataset(from, to, 100, 50);
    });
    render(<CudyrMonthlyIndicator date="2026-10-10" />);
    await waitFor(() => expect(screen.getByText(/Acum\. 2026/)).toHaveTextContent('No disponible'));
    expect(screen.getByText('50/100 elegibles')).toBeVisible();
    expect(screen.getByText(/Acum\. 2026/)).not.toHaveTextContent('50%');
  });
  it('clears displayed summaries on session change and follows the census month', async () => {
    const view = render(<CudyrMonthlyIndicator date="2026-10-10" />);
    await screen.findByText('50/100 elegibles');
    session.generation += 'new';
    vi.mocked(loadCudyrReport).mockImplementation(async (from, to) => dataset(from, to, 2, 1));
    view.rerender(<CudyrMonthlyIndicator date="2026-09-30" />);
    expect(screen.queryByText('50/100 elegibles')).not.toBeInTheDocument();
    await screen.findByText('1/2 elegibles');
    expect(screen.getByRole('combobox')).toHaveValue('2026-09');
  });
  it('aborts obsolete in-flight readers when navigating quickly across a longer history', async () => {
    vi.setSystemTime(new Date('2027-04-10T20:00:00Z'));
    vi.mocked(loadCudyrReport).mockImplementation(() => new Promise(() => {}));
    const view = render(<CudyrMonthlyIndicator date="2027-04-10" />);
    await waitFor(() => expect(loadCudyrReport).toHaveBeenCalledTimes(2));
    const selector = screen.getByRole('combobox');
    for (const month of ['2027-03', '2027-02', '2027-01', '2027-04']) {
      fireEvent.change(selector, { target: { value: month } });
      await waitFor(() =>
        expect(
          vi.mocked(loadCudyrReport).mock.calls.filter(call => !call[2]?.aborted).length
        ).toBeLessThanOrEqual(2)
      );
    }
    expect(vi.mocked(loadCudyrReport).mock.calls.some(call => call[2]?.aborted)).toBe(true);
    view.unmount();
    expect(vi.mocked(loadCudyrReport).mock.calls.every(call => call[2]?.aborted)).toBe(true);
  });
  it('handles an open first day without reading or including it in the annual denominator', async () => {
    vi.setSystemTime(new Date('2026-08-01T20:00:00Z'));
    render(<CudyrMonthlyIndicator date="2026-08-01" />);
    expect(screen.getByText('Sin días cerrados')).toBeVisible();
    expect(screen.getByText(/Acum\. 2026/)).not.toHaveTextContent('Leyendo');
    expect(loadCudyrReport).not.toHaveBeenCalled();
  });
});
