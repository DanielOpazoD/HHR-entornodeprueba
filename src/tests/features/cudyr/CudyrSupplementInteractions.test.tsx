import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CudyrSupplementImport } from '@/features/cudyr/components/CudyrSupplementImport';
import { CudyrSupplementPanel } from '@/features/cudyr/components/CudyrSupplementPanel';
import { useCudyrSupplements } from '@/features/cudyr/hooks/useCudyrSupplements';
import { readCudyrSupplementFile } from '@/services/cudyr/cudyrSupplementFile';
import {
  importCudyrSupplement,
  loadCudyrSupplements,
} from '@/services/cudyr/cudyrSupplementService';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../../services/cudyr/reportFixtures';
const auth = vi.hoisted(() => ({ currentUser: { uid: 'synthetic-user' }, role: 'admin' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/services/cudyr/cudyrSupplementFile', () => ({ readCudyrSupplementFile: vi.fn() }));
vi.mock('@/services/cudyr/cudyrSupplementService', async original => ({
  ...(await original<object>()),
  importCudyrSupplement: vi.fn(),
  loadCudyrSupplements: vi.fn(),
}));
const preview = (): Awaited<ReturnType<typeof readCudyrSupplementFile>> => ({
  operationId: '00000000-0000-4000-8000-000000000001',
  file: { name: 'synthetic.xls', base64: 'test' },
  report: {
    schemaVersion: 1,
    source: 'eloisa_monthly_report',
    month: '2026-10',
    establishment: 'Hospital Hanga Roa',
    generatedLabel: 'Impresión sintética',
    sheet: 'Synthetic',
    patients: [
      {
        sourceRow: 5,
        ordinal: 1,
        patientName: 'Paciente Sintético',
        document: '11111111-1',
        clinicalRecord: '',
        diagnosis: 'Diagnóstico sintético',
        hospitalDays: '3',
        service: 'MQ',
        dischargeCondition: 'Vivo',
        days: [],
      },
    ],
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser.uid = 'synthetic-user';
  setSessionGeneration(null);
});
describe('passive supplement interactions', () => {
  it('keeps the complementary panel closed and import absent for read-only access', () => {
    render(
      <CudyrSupplementPanel
        reports={[]}
        ready
        error=""
        from="2026-10-01"
        to="2026-10-07"
        canImport={false}
        onReload={vi.fn()}
      />
    );
    expect(screen.getByTestId('cudyr-supplement-panel')).not.toHaveAttribute('open');
    expect(screen.queryByLabelText('Agregar informe mensual de Eloísa')).not.toBeInTheDocument();
  });
  it('requires preview confirmation and keeps the same id on a lost response retry', async () => {
    vi.mocked(readCudyrSupplementFile).mockResolvedValue(preview());
    vi.mocked(importCudyrSupplement).mockRejectedValue(new Error('response lost'));
    render(<CudyrSupplementImport from="2026-10-01" to="2026-10-07" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Agregar informe mensual de Eloísa'), {
      target: { files: [new File(['fake'], 'synthetic.xls')] },
    });
    const save = await screen.findByRole('button', { name: 'Guardar respaldo' });
    expect(save).toBeDisabled();
    expect(importCudyrSupplement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);
    await screen.findByText(/No se confirmó el guardado/);
    fireEvent.click(save);
    await waitFor(() => expect(importCudyrSupplement).toHaveBeenCalledTimes(2));
    expect(vi.mocked(importCudyrSupplement).mock.calls[0][0].operationId).toBe(
      vi.mocked(importCudyrSupplement).mock.calls[1][0].operationId
    );
  });
  it('starts a clean import after session replacement and discards the previous file read', async () => {
    let resolveOld!: (value: ReturnType<typeof preview>) => void;
    vi.mocked(readCudyrSupplementFile)
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce({ ...preview(), file: { name: 'new-session.xls', base64: 'test' } });
    const props = { from: '2026-10-01', to: '2026-10-07', onSaved: vi.fn() };
    const { rerender } = render(<CudyrSupplementImport {...props} />);
    const select = () =>
      fireEvent.change(screen.getByLabelText('Agregar informe mensual de Eloísa'), {
        target: { files: [new File(['fake'], 'synthetic.xls')] },
      });
    select();
    expect(screen.getByLabelText('Agregar informe mensual de Eloísa')).toBeDisabled();
    auth.currentUser.uid = 'replacement-user';
    setSessionGeneration('replacement-generation');
    rerender(<CudyrSupplementImport {...props} />);
    expect(screen.getByLabelText('Agregar informe mensual de Eloísa')).toBeEnabled();
    select();
    await screen.findByText('new-session.xls');
    await act(async () => resolveOld(preview()));
    expect(screen.getByText('new-session.xls')).toBeInTheDocument();
    expect(screen.queryByText('synthetic.xls')).not.toBeInTheDocument();
  });
  it('ignores old period results and withholds ready state after a failed read', async () => {
    let resolveOld!: (value: []) => void;
    vi.mocked(loadCudyrSupplements)
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('unavailable'));
    const one = buildCudyrReport(reportInput());
    const two = { ...one, generatedAt: '2026-10-08T12:00:00Z' };
    const { result, rerender } = renderHook(({ data }) => useCudyrSupplements(data), {
      initialProps: { data: one },
    });
    rerender({ data: two });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => resolveOld([]));
    expect(result.current.ready).toBe(true);
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.error).toContain('No se pudo'));
    expect(result.current.ready).toBe(false);
    expect(result.current.reports).toEqual([]);
  });
});
