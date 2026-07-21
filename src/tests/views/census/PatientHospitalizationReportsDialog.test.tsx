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
      clinicalEpisodeId: '200',
      admissionDate: undefined,
      censusDate: '2026-07-19',
    });

    const epicrisisButtons = screen.getAllByRole('button', { name: 'Epicrisis' });
    fireEvent.click(epicrisisButtons[1]);
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        patientRun: '17.752.753-1',
        admissionDate: '2025-05-01',
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
        admissionDate: '2026-07-18',
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

  it('shows direct episode status as unknown and disables full history without an admission date', async () => {
    mocks.list.mockResolvedValueOnce({
      ok: true,
      episodes: [{ encId: '141814', startDate: '', endDate: '' }],
    });
    render(
      <PatientHospitalizationReportsDialog
        isOpen
        onClose={vi.fn()}
        patientName="RN sin RUN"
        patientRun=""
        currentEpisodeId="141814"
      />
    );

    expect(await screen.findByText('Fecha de ingreso no disponible')).toBeInTheDocument();
    expect(screen.queryByText('Vigente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Epicrisis' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ficha completa' })).toBeDisabled();
  });

  it('uses the census admission date only for the matching direct episode', async () => {
    mocks.list.mockResolvedValueOnce({
      ok: true,
      episodes: [{ encId: '141814', startDate: '', endDate: '' }],
    });
    render(
      <PatientHospitalizationReportsDialog
        isOpen
        onClose={vi.fn()}
        patientName="RN sin RUN"
        patientRun=""
        currentEpisodeId="141814"
        admissionDate="2026-07-20"
        censusDate="2026-07-21"
      />
    );

    expect(await screen.findByText('20/07/2026 – estado no verificado')).toBeInTheDocument();
    const historyButton = screen.getByRole('button', { name: 'Ficha completa' });
    expect(historyButton).toBeEnabled();

    fireEvent.click(historyButton);
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        patientRun: '',
        admissionDate: '2026-07-20',
        censusDate: '2026-07-21',
        clinicalEpisodeId: '141814',
        documentType: 'history',
      })
    );
  });

  it('does not inherit the current admission date for a historical episode without dates', async () => {
    mocks.list.mockResolvedValueOnce({
      ok: true,
      episodes: [
        { encId: '200', startDate: '', endDate: '' },
        { encId: '100', startDate: '', endDate: '' },
      ],
    });
    render(
      <PatientHospitalizationReportsDialog
        isOpen
        onClose={vi.fn()}
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        currentEpisodeId="200"
        admissionDate="2026-07-20"
      />
    );

    expect(await screen.findByText('20/07/2026 – estado no verificado')).toBeInTheDocument();
    expect(screen.getByText('Fecha de ingreso no disponible')).toBeInTheDocument();
    const historyButtons = screen.getAllByRole('button', { name: 'Ficha completa' });
    expect(historyButtons[0]).toBeEnabled();
    expect(historyButtons[1]).toBeDisabled();

    const epicrisisButtons = screen.getAllByRole('button', { name: 'Epicrisis' });
    fireEvent.click(epicrisisButtons[1]);
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        patientRun: '17.752.753-1',
        clinicalEpisodeId: '100',
        documentType: 'epicrisis',
      })
    );
  });
});
