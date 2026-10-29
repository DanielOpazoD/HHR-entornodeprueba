import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatisticalDischargeProvenanceBadge } from '@/features/census/components/StatisticalDischargeProvenanceBadge';
import { requestRayenStatisticalDischargeReport } from '@/features/rayen-import/census-status';

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/context/UIContext', () => ({ useNotification: () => notifications }));
vi.mock('@/features/rayen-import/census-status', () => ({
  requestRayenStatisticalDischargeReport: vi.fn(),
}));

describe('statistical discharge download feedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows progress during the real request lifecycle, prevents repeat clicks and permits retry', async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof requestRayenStatisticalDischargeReport>>>();
    vi.mocked(requestRayenStatisticalDischargeReport)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ ok: true, opened: true });
    render(
      <StatisticalDischargeProvenanceBadge
        clinicalEpisodeId="900001"
        patientName="Paciente Sintético"
        provenance={{
          source: 'gestion_camas',
          lineageId: 'synthetic-movement',
          syncRunId: 'synthetic-run',
          classifiedAt: '2026-04-03T12:00:00.000Z',
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Descargar PDF del egreso/ }));
    const busy = screen.getByRole('button', { name: /Descargando/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Descargando…');
    fireEvent.click(busy);
    expect(requestRayenStatisticalDischargeReport).toHaveBeenCalledExactlyOnceWith('900001');

    await act(async () => pending.resolve({ ok: false, error: 'Error sintético' }));
    expect(notifications.error).toHaveBeenCalledWith(
      'No se pudo descargar el egreso',
      'Error sintético'
    );
    const retry = screen.getByRole('button', { name: /Descargar PDF del egreso/ });
    expect(retry).toBeEnabled();
    expect(retry).toHaveTextContent('Egreso estad.');
    fireEvent.click(retry);
    await waitFor(() => expect(notifications.success).toHaveBeenCalledOnce());
    expect(requestRayenStatisticalDischargeReport).toHaveBeenCalledTimes(2);
  });
});
