import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CudyrReportDetail } from '@/features/cudyr/components/CudyrReportDetail';
import {
  reportObservation,
  reportCapture,
  reportRecord,
  reportPatient,
} from '../../services/cudyr/reportFixtures';
import { CudyrActualDischargeDialog } from '@/features/cudyr/components/CudyrActualDischargeDialog';
import { correctCudyrDischarge } from '@/services/cudyr/cudyrDischargeService';
import { useCudyrReport } from '@/features/cudyr/hooks/useCudyrReport';
import { renderHook, act } from '@testing-library/react';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../../services/cudyr/reportFixtures';
import { canCorrectCudyrDischarge } from '@/shared/access/operationalAccessPolicy';
vi.mock('@/services/cudyr/cudyrDischargeService', () => ({ correctCudyrDischarge: vi.fn() }));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const props = {
  clinicalEpisodeId: 'synthetic-episode',
  authorityDate: '2026-10-02',
  patientName: 'Paciente Sintético',
  admissionDate: '2026-09-20',
  sourceDischargeLabel: '2026-10-04 12:00',
  canEdit: true,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};
describe('CUDYR report interactions', () => {
  it('keeps correction permissions consistent with the callable and a read-only screen', () => {
    for (const role of ['admin', 'nurse_hospital']) {
      expect(canCorrectCudyrDischarge({ role, readOnly: false })).toBe(true);
      expect(canCorrectCudyrDischarge({ role, readOnly: true })).toBe(false);
    }
    for (const role of ['doctor_urgency', 'doctor_specialist', 'viewer', 'editor', undefined])
      expect(canCorrectCudyrDischarge({ role, readOnly: false })).toBe(false);
  });
  it('does not attach anonymous archived authors or captures to an unidentified daily patient', () => {
    const observation = reportObservation();
    observation.evaluation.clinicalEpisodeId = '';
    const capture = reportCapture();
    capture.capture.clinicalEpisodeId = '';
    const data = buildCudyrReport(
      reportInput({
        records: [
          reportRecord('2026-10-02', { R1: reportPatient({ clinicalEpisodeId: undefined }) }),
        ],
        observations: [observation],
        captures: [capture],
      })
    );
    const row = data.rows.find(item => !item.clinicalEpisodeId)!;
    expect(row.captureActor).toBe('');
    expect(row.lastCaptureAt).toBe('');
    render(
      <CudyrReportDetail
        row={row}
        data={data}
        canEdit={false}
        onClose={vi.fn()}
        onCorrect={vi.fn()}
      />
    );
    expect(screen.queryByText('Autora Sintética')).not.toBeInTheDocument();
    expect(screen.queryByText('sync@example.com')).not.toBeInTheDocument();
  });
  it('requires reason and confirmation and retains the operation id when a response is lost', async () => {
    vi.mocked(correctCudyrDischarge).mockReset().mockRejectedValue(new Error('Respuesta perdida'));
    render(<CudyrActualDischargeDialog {...props} />);
    const save = screen.getByRole('button', { name: 'Guardar alta real' });
    fireEvent.change(screen.getByLabelText('Fecha real de alta'), {
      target: { value: '2026-10-02' },
    });
    fireEvent.change(screen.getByLabelText('Motivo y respaldo de la corrección'), {
      target: { value: 'Respaldo sintético' },
    });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);
    await screen.findByText('Respuesta perdida');
    fireEvent.click(save);
    await waitFor(() => expect(correctCudyrDischarge).toHaveBeenCalledTimes(2));
    const [a, b] = vi.mocked(correctCudyrDischarge).mock.calls;
    expect(a[0].operationId).toBe(b[0].operationId);
    expect(a[0].actualDischarge).toEqual({ date: '2026-10-02', timeZone: 'Pacific/Easter' });
  });
  it('keeps a read-only user from sending a correction', () => {
    vi.mocked(correctCudyrDischarge).mockClear();
    render(<CudyrActualDischargeDialog {...props} canEdit={false} />);
    expect(screen.getByLabelText('Fecha real de alta')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar alta real' })).toBeDisabled();
    expect(correctCudyrDischarge).not.toHaveBeenCalled();
  });
  it('ignores an older in-flight report after a newer period is requested and aborts on unmount', async () => {
    let resolveOld!: (value: ReturnType<typeof buildCudyrReport>) => void;
    const old = new Promise<ReturnType<typeof buildCudyrReport>>(resolve => {
      resolveOld = resolve;
    });
    const newer = buildCudyrReport(reportInput({ from: '2026-10-02', to: '2026-10-02' }));
    const loader = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(newer);
    const { result, unmount } = renderHook(() => useCudyrReport('2026-10-01', loader));
    await act(async () => result.current.load('2026-10-02', '2026-10-02'));
    expect(result.current.data?.from).toBe('2026-10-02');
    await act(async () => resolveOld(buildCudyrReport(reportInput())));
    expect(result.current.data?.from).toBe('2026-10-02');
    expect(loader.mock.calls[0][2].aborted).toBe(true);
    unmount();
    expect(loader.mock.calls[1][2].aborted).toBe(true);
  });
  it('loads month-to-date on first render and when the selected census day changes', async () => {
    const loader = vi.fn().mockResolvedValue(buildCudyrReport(reportInput()));
    const { rerender } = renderHook(({ date }) => useCudyrReport(date, loader), {
      initialProps: { date: '2026-10-07' },
    });
    await waitFor(() =>
      expect(loader).toHaveBeenCalledWith('2026-10-01', '2026-10-07', expect.any(AbortSignal))
    );
    rerender({ date: '2026-09-30' });
    await waitFor(() =>
      expect(loader).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30', expect.any(AbortSignal))
    );
  });
});
