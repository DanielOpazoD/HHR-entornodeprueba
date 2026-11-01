import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DailyRecordRestorePanel } from '@/features/admin/components/DailyRecordRestorePanel';
import {
  previewDailyRecordRestore,
  restoreDailyRecord,
} from '@/services/admin/dailyRecordRestoreService';
vi.mock('@/services/admin/dailyRecordRestoreService', () => ({
  previewDailyRecordRestore: vi.fn(),
  restoreDailyRecord: vi.fn(),
}));
const session = vi.hoisted(() => ({ currentUser: { role: 'admin' } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => session }));
const summary = {
  lastUpdated: '2026-11-01T15:00:00.000Z',
  revision: 10,
  occupiedBeds: [],
  clinicalCribs: [],
  discharges: [],
  transfers: [],
  cma: [],
  episodeDocuments: [],
  warnings: ['El día contiene CUDYR: puede incluir resultados saneados.'],
};
const date = '2026-11-01';
const consult = () => {
  fireEvent.change(screen.getByLabelText('Fecha del censo'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Momento a recuperar (hora de Rapa Nui)'), {
    target: { value: '2026-11-01T10:00' },
  });
  fireEvent.click(screen.getByText('Consultar comparación'));
};
beforeEach(() => {
  vi.resetAllMocks();
  session.currentUser.role = 'admin';
  vi.mocked(previewDailyRecordRestore).mockResolvedValue({
    date,
    current: summary,
    selected: summary,
  });
});
describe('administrative daily restore screen', () => {
  it('hides restoration from a non-administrator', () => {
    session.currentUser.role = 'nurse_hospital';
    render(<DailyRecordRestorePanel />);
    expect(screen.queryByText('Consultar comparación')).toBeNull();
  });
  it('shows a failed read and never offers restoration or an empty comparison', async () => {
    vi.mocked(previewDailyRecordRestore).mockRejectedValue(new Error('synthetic failure'));
    render(<DailyRecordRestorePanel />);
    consult();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la comparación');
    expect(screen.queryByText('Estado actual')).toBeNull();
    expect(screen.queryByText('Restaurar el día completo')).toBeNull();
    expect(restoreDailyRecord).not.toHaveBeenCalled();
  });
  it('requires exact date and displayed version, then offers comparison to undo', async () => {
    vi.mocked(restoreDailyRecord).mockResolvedValue({
      success: true,
      date,
      lastUpdated: '2026-11-01T16:00:00.000Z',
      revision: 11,
      backupId: 'restore_synthetic',
      backupExpiresAt: '2026-11-03T16:00:00.000Z',
    });
    render(<DailyRecordRestorePanel />);
    consult();
    const button = await screen.findByText('Restaurar el día completo');
    expect(button).toBeDisabled();
    expect(screen.getAllByText(/Atención: El día contiene CUDYR/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText(`Escriba ${date} para confirmar`), {
      target: { value: date },
    });
    fireEvent.click(button);
    expect(await screen.findByText(/Restauración confirmada/)).toBeInTheDocument();
    expect(restoreDailyRecord).toHaveBeenCalledWith({
      date,
      readTime: '2026-11-01T15:00:00.000Z',
      expectedLastUpdated: summary.lastUpdated,
      confirmationDate: date,
    });
    fireEvent.click(screen.getByText('Comparar para deshacer esta restauración'));
    await waitFor(() =>
      expect(previewDailyRecordRestore).toHaveBeenLastCalledWith({
        date,
        backupId: 'restore_synthetic',
      })
    );
  });
  it('invalidates an old comparison when the selection changes', async () => {
    render(<DailyRecordRestorePanel />);
    consult();
    await screen.findByText('Restaurar el día completo');
    fireEvent.change(screen.getByLabelText('Fecha del censo'), { target: { value: '2026-10-31' } });
    expect(screen.queryByText('Restaurar el día completo')).toBeNull();
  });
  it('does not claim success after a restore failure', async () => {
    vi.mocked(restoreDailyRecord).mockRejectedValue(new Error('conflict'));
    render(<DailyRecordRestorePanel />);
    consult();
    await screen.findByText('Restaurar el día completo');
    fireEvent.change(screen.getByLabelText(`Escriba ${date} para confirmar`), {
      target: { value: date },
    });
    fireEvent.click(screen.getByText('Restaurar el día completo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se confirmó la restauración');
    expect(screen.queryByText(/Restauración confirmada/)).toBeNull();
  });
  it('can load a pre-restore copy after reopening the tool', async () => {
    render(<DailyRecordRestorePanel />);
    fireEvent.change(screen.getByLabelText('Copia previa para deshacer (opcional)'), {
      target: { value: 'restore_synthetic' },
    });
    consult();
    await screen.findByText('Estado actual');
    expect(previewDailyRecordRestore).toHaveBeenCalledWith({ date, backupId: 'restore_synthetic' });
  });
});
