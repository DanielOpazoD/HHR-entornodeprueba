import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CudyrReportExplorer from '@/features/cudyr/components/CudyrReportExplorer';
import { loadCudyrReport } from '@/services/cudyr/cudyrReportLoader';
import { loadCudyrSupplements } from '@/services/cudyr/cudyrSupplementService';
import { cudyrReportCache } from '@/services/cudyr/cudyrReportCache';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '@/tests/services/cudyr/reportFixtures';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

const session = vi.hoisted(() => ({ generation: 0 }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'viewer', currentUser: { uid: 'synthetic' } }),
}));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => 'synthetic',
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => String(session.generation),
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({ loadCudyrSupplements: vi.fn() }));
vi.mock('@/services/cudyr/cudyrReadView', () => ({
  readCudyrReadView: vi.fn().mockResolvedValue(null),
  saveCudyrReadView: vi.fn(),
}));
vi.mock('@/features/cudyr/components/CudyrMonthlyReconciliation', () => ({
  CudyrMonthlyReconciliation: () => null,
}));
vi.mock('@/features/cudyr/components/CudyrSupplementPanel', () => ({
  CudyrSupplementPanel: ({ onReload }: { onReload: () => void }) => (
    <button onClick={onReload}>Reintentar respaldo</button>
  ),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const report = () => ({
  ...buildCudyrReport(reportInput({ from: '2026-10-01', to: '2026-10-02' })),
  loadedAt: new Date().toISOString(),
});
const seed = (data: CudyrReportDataset) =>
  cudyrReportCache(loadCudyrReport, `synthetic:${session.generation}`, true).put(data);
const exports = () => [
  screen.getByRole('button', { name: 'Excel para Estadística' }),
  screen.getByRole('button', { name: 'Excel de auditoría' }),
];
beforeEach(() => {
  session.generation++;
  sessionStorage.clear();
  vi.mocked(loadCudyrReport).mockReset();
  vi.mocked(loadCudyrSupplements).mockReset().mockResolvedValue([]);
});

describe('CUDYR explorer loading with real report and supplement hooks', () => {
  it('reads the monthly backup once per verified report, including explicit refresh', async () => {
    const data = report();
    seed(data);
    const first = deferred<CudyrReportDataset>();
    vi.mocked(loadCudyrReport).mockReturnValueOnce(first.promise);
    render(<CudyrReportExplorer initialDate={data.to} readOnly onBack={() => {}} />);
    exports().forEach(button => expect(button).toBeDisabled());
    await act(async () => first.resolve(data));
    await waitFor(() => exports().forEach(button => expect(button).toBeEnabled()));
    expect(loadCudyrSupplements).toHaveBeenCalledTimes(1);

    const next = deferred<CudyrReportDataset>();
    const backup = deferred<Awaited<ReturnType<typeof loadCudyrSupplements>>>();
    vi.mocked(loadCudyrReport).mockReturnValueOnce(next.promise);
    vi.mocked(loadCudyrSupplements).mockReturnValueOnce(backup.promise);
    fireEvent.submit(screen.getByLabelText('Desde').closest('form')!);
    exports().forEach(button => expect(button).toBeDisabled());
    expect(loadCudyrSupplements).toHaveBeenCalledTimes(1);
    // An unchanged official snapshot can retain its generatedAt after verification.
    await act(async () => next.resolve(data));
    exports().forEach(button => expect(button).toBeDisabled());
    await act(async () => backup.resolve([]));
    await waitFor(() => exports().forEach(button => expect(button).toBeEnabled()));
    expect(loadCudyrSupplements).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'incomplete'])(
    'keeps exports blocked after a %s verification',
    async state => {
      const data = report();
      seed(data);
      const pending = deferred<CudyrReportDataset>();
      vi.mocked(loadCudyrReport).mockReturnValueOnce(pending.promise);
      render(<CudyrReportExplorer initialDate={data.to} readOnly onBack={() => {}} />);
      await act(async () => {
        if (state === 'failed') pending.reject(new Error('Sin conexión'));
        else pending.resolve({ ...data, issues: ['Lectura incompleta'] });
      });
      exports().forEach(button => expect(button).toBeDisabled());
      expect(loadCudyrSupplements).not.toHaveBeenCalled();
      expect(screen.getByText('Paciente Sintético')).toBeVisible();
    }
  );

  it('waits for the backup and allows retry after its read fails', async () => {
    const data = report();
    vi.mocked(loadCudyrReport).mockResolvedValue(data);
    const pending = deferred<Awaited<ReturnType<typeof loadCudyrSupplements>>>();
    vi.mocked(loadCudyrSupplements).mockReturnValueOnce(pending.promise);
    render(<CudyrReportExplorer initialDate={data.to} readOnly onBack={() => {}} />);
    await waitFor(() => expect(loadCudyrSupplements).toHaveBeenCalledTimes(1));
    exports().forEach(button => expect(button).toBeDisabled());
    await act(async () => pending.reject(new Error('Sin conexión')));
    exports().forEach(button => expect(button).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar respaldo' }));
    await waitFor(() => exports().forEach(button => expect(button).toBeEnabled()));
    expect(loadCudyrSupplements).toHaveBeenCalledTimes(2);
  });
});
