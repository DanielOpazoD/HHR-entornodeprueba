import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalErrorLogsView } from '@/features/admin/components/LocalErrorLogsView';
import { clearErrorLogs, fetchErrorLogs } from '@/services/errorLogService';
import type { ErrorLog } from '@/services/logging/errorLogTypes';

vi.mock('@/services/errorLogService', () => ({
  clearErrorLogs: vi.fn(),
  fetchErrorLogs: vi.fn(),
}));

const buildLog = (overrides: Partial<ErrorLog> = {}): ErrorLog => ({
  id: 'err-1',
  timestamp: '2026-05-28T21:10:00.000Z',
  message: 'Fallo al guardar respaldo local',
  severity: 'high',
  stack: 'Error: fallo\n    at saveRecord',
  context: {
    module: 'Censo diario',
    action: 'Guardar paciente',
    bedLabel: 'Cama R1',
  },
  url: 'http://127.0.0.1:3021/census',
  userAgent: 'Vitest',
  ...overrides,
});

describe('LocalErrorLogsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchErrorLogs).mockResolvedValue([buildLog()]);
    vi.mocked(clearErrorLogs).mockResolvedValue(undefined);
  });

  it('renders local technical error logs from IndexedDB', async () => {
    render(<LocalErrorLogsView />);

    expect(await screen.findByText('Errores locales')).toBeInTheDocument();
    expect(screen.getByText('1 registro')).toBeInTheDocument();
    expect(screen.getByText('Fallo al guardar respaldo local')).toBeInTheDocument();
    expect(screen.getAllByText('Alta').length).toBeGreaterThan(0);
    expect(screen.getByText('/census')).toBeInTheDocument();
    expect(screen.getByText('module: Censo diario')).toBeInTheDocument();
    expect(screen.getByText('action: Guardar paciente')).toBeInTheDocument();
    expect(screen.getByText('bedLabel: Cama R1')).toBeInTheDocument();
  });

  it('shows a clear empty state when there are no local logs', async () => {
    vi.mocked(fetchErrorLogs).mockResolvedValueOnce([]);

    render(<LocalErrorLogsView />);

    expect(await screen.findByText('No hay errores locales registrados.')).toBeInTheDocument();
  });

  it('refreshes and clears the local log store', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchErrorLogs).mockResolvedValueOnce([buildLog()]).mockResolvedValueOnce([]);

    render(<LocalErrorLogsView />);

    expect(await screen.findByText('Fallo al guardar respaldo local')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Limpiar/i }));

    await waitFor(() => expect(clearErrorLogs).toHaveBeenCalledTimes(1));
    expect(fetchErrorLogs).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('No hay errores locales registrados.')).toBeInTheDocument();
  });
});
