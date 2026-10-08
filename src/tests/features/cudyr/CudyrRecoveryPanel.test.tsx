import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CudyrRecoveryPanel } from '@/features/cudyr/components/CudyrRecoveryPanel';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../../services/cudyr/reportFixtures';
const ports = vi.hoisted(() => ({
  download: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/services/cudyr/cudyrRecoveryWorkbook', () => ({
  downloadCudyrRecoveryPlan: ports.download,
}));
vi.mock('@/features/rayen-import/clinical-panel', () => ({
  requestRayenEncounterNavigation: ports.navigate,
}));

describe('bounded recovery UI', () => {
  it('is complementary and downloads only selected known cases without source calls', async () => {
    ports.download.mockClear();
    ports.navigate.mockClear();
    const data = buildCudyrReport(reportInput()),
      onView = vi.fn(),
      before = JSON.stringify(data);
    render(<CudyrRecoveryPanel data={data} onView={onView} />);
    expect(screen.getByTestId('cudyr-recovery-plan')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/Preparar búsqueda dirigida/));
    expect(ports.download).not.toHaveBeenCalled();
    expect(ports.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Descargar lista/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Descargar lista/ }));
    await waitFor(() => expect(ports.download).toHaveBeenCalledTimes(1));
    expect(ports.download.mock.calls[0][1]).toHaveLength(1);
    expect(ports.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).toBe(before);
  });
  it('opens the exact episode only after an explicit action', async () => {
    ports.navigate.mockClear();
    const data = buildCudyrReport(reportInput());
    render(<CudyrRecoveryPanel data={data} onView={vi.fn()} />);
    fireEvent.click(screen.getByText(/Preparar búsqueda dirigida/));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ficha del episodio en Eloísa' }));
    await waitFor(() => expect(ports.navigate).toHaveBeenCalledWith('synthetic-episode'));
    expect(await screen.findByRole('status')).toHaveTextContent('no recupera ni guarda CUDYR');
  });
  it('blocks navigation when episode identity is inconsistent', () => {
    const data = buildCudyrReport(reportInput());
    data.rows.push({ ...data.rows[0], key: 'conflict', rut: 'another-person' });
    render(<CudyrRecoveryPanel data={data} onView={vi.fn()} />);
    fireEvent.click(screen.getByText(/Preparar búsqueda dirigida/));
    for (const button of screen.getAllByRole('button', {
      name: 'Abrir ficha del episodio en Eloísa',
    }))
      expect(button).toBeDisabled();
  });
});
