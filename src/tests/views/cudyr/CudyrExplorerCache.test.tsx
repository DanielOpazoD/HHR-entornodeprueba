import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CudyrReportExplorer from '@/features/cudyr/components/CudyrReportExplorer';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '@/tests/services/cudyr/reportFixtures';
const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'admin', currentUser: { uid: 'synthetic' } }),
}));
vi.mock('@/features/cudyr/hooks/useCudyrReport', () => ({ useCudyrReport: () => mocks.report() }));
vi.mock('@/features/cudyr/hooks/useCudyrSupplements', () => ({
  useCudyrSupplements: () => ({ ready: true, reports: [], error: '', reload: vi.fn() }),
}));
vi.mock('@/features/cudyr/components/CudyrMonthlyReconciliation', () => ({
  CudyrMonthlyReconciliation: () => null,
}));
vi.mock('@/features/cudyr/components/CudyrSupplementPanel', () => ({
  CudyrSupplementPanel: () => null,
}));
describe('explorer cache export verification', () => {
  it.each(['busy', 'thrown', 'partial', 'coverage', 'complete'])(
    'protects both exports for %s reads',
    state => {
      const data = buildCudyrReport(reportInput());
      if (state === 'partial') data.issues = ['Lectura incompleta'];
      if (state === 'coverage')
        data.coverage = [{ date: data.to, state: 'error', lastSyncedAt: '', runId: '' }];
      mocks.report.mockReturnValue({
        data,
        busy: state === 'busy',
        error: state === 'thrown' ? 'Sin conexión' : '',
        load: vi.fn(),
      });
      render(<CudyrReportExplorer initialDate={data.to} readOnly onBack={() => {}} />);
      for (const label of ['Excel para Estadística', 'Excel de auditoría']) {
        if (state === 'complete') expect(screen.getByRole('button', { name: label })).toBeEnabled();
        else expect(screen.getByRole('button', { name: label })).toBeDisabled();
      }
    }
  );
});
