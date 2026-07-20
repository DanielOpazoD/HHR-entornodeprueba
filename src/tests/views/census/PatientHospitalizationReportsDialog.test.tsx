import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/rayen-import', () => ({
  requestRayenHospitalizationEpisodes: (...args: unknown[]) => mocks.list(...args),
  requestRayenHospitalizationDocument: (...args: unknown[]) => mocks.download(...args),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

import { PatientHospitalizationReportsDialog } from '@/features/census/components/PatientHospitalizationReportsDialog';

describe('PatientHospitalizationReportsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({
      ok: true,
      episodes: [
        { encId: '200', startDate: '2026-07-18', endDate: '', active: true },
        { encId: '100', startDate: '2025-05-01', endDate: '2025-05-05', active: false },
      ],
    });
    mocks.download.mockResolvedValue({ ok: true, opened: true });
  });

  it('lists multiple episodes and requests each document for the selected hospitalization', async () => {
    render(
      <PatientHospitalizationReportsDialog
        isOpen
        onClose={vi.fn()}
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        currentEpisodeId="200"
        censusDate="2026-07-19"
      />
    );

    expect(await screen.findByText('18/07/2026 – hospitalización vigente')).toBeInTheDocument();
    expect(screen.getByText('01/05/2025 – 05/05/2025')).toBeInTheDocument();
    expect(screen.getByText('Episodio del censo')).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith({
      patientName: 'Paciente de prueba',
      patientRun: '17.752.753-1',
      censusDate: '2026-07-19',
    });

    const epicrisisButtons = screen.getAllByRole('button', { name: 'Epicrisis' });
    fireEvent.click(epicrisisButtons[1]);
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        patientRun: '17.752.753-1',
        censusDate: '2026-07-19',
        clinicalEpisodeId: '100',
        documentType: 'epicrisis',
      })
    );

    const historyButtons = screen.getAllByRole('button', { name: 'Ficha completa' });
    fireEvent.click(historyButtons[0]);
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        patientRun: '17.752.753-1',
        censusDate: '2026-07-19',
        clinicalEpisodeId: '200',
        documentType: 'history',
      })
    );
  });

  it('keeps lookup errors calm and retryable', async () => {
    mocks.list.mockResolvedValueOnce({ ok: false, error: 'Eloísa no respondió.' });
    render(
      <PatientHospitalizationReportsDialog
        isOpen
        onClose={vi.fn()}
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
      />
    );

    expect(await screen.findByText('Eloísa no respondió.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
});
