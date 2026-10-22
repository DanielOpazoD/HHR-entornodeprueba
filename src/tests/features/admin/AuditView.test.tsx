import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditView } from '@/features/admin/components/AuditView';
import { useAuth } from '@/context/AuthContext';
import { executeFetchAuditLogRange } from '@/application/audit/fetchAuditLogsUseCase';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import { AUDIT_TRAIL_VIEW_STORAGE_KEY } from '@/services/admin/auditTrail/auditTrailPreferences';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/application/audit/fetchAuditLogsUseCase', () => ({
  executeFetchAuditLogRange: vi.fn(),
}));

vi.mock('@/features/admin/components/internal/audit/ExportKeysPanel', () => ({
  ExportKeysPanel: () => <div>Panel de claves</div>,
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const logs = (): AuditLogEntry[] => [
  {
    id: 'login-ana',
    timestamp: minutesAgo(90),
    userId: 'ana.soto@hospital.test',
    userDisplayName: 'Ana Soto',
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: 'ana.soto@hospital.test',
    sessionId: 'conn-ana',
    device: 'Chrome · Windows',
    details: { start: 'sign_in' },
  },
  {
    id: 'dx-jose',
    timestamp: minutesAgo(60),
    userId: 'ana.soto@hospital.test',
    userDisplayName: 'Ana Soto',
    action: 'PATIENT_DIAGNOSIS_CHANGED',
    entityType: 'patient',
    entityId: 'H3C2',
    sessionId: 'conn-ana',
    details: {
      patientName: 'José Pérez',
      rut: '12.345.678-5',
      bedId: 'H3C2',
      changes: { diagnosis: { old: 'Neumonía', new: 'Neumonía grave' } },
      error: { stack: 'never shown' },
    },
  },
  {
    id: 'view-maria',
    timestamp: minutesAgo(30),
    userId: 'luis.rojas@hospital.test',
    userDisplayName: 'Luis Rojas',
    action: 'VIEW_PATIENT',
    entityType: 'patient',
    entityId: 'H1C1',
    details: { patientName: 'María Rojas', rut: '9.876.543-2', bedId: 'H1C1' },
  },
  {
    id: 'clear-maria',
    timestamp: minutesAgo(20),
    userId: 'luis.rojas@hospital.test',
    userDisplayName: 'Luis Rojas',
    action: 'PATIENT_CLEARED',
    entityType: 'patient',
    entityId: 'H1C1',
    details: { patientName: 'María Rojas', bedId: 'H1C1' },
  },
];

const renderView = async () => {
  render(<AuditView />);
  await screen.findByText('José Pérez', undefined, { timeout: 5000 });
};

describe('AuditView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(AUDIT_TRAIL_VIEW_STORAGE_KEY);
    vi.mocked(useAuth).mockReturnValue({ role: 'admin' } as ReturnType<typeof useAuth>);
    vi.mocked(executeFetchAuditLogRange).mockResolvedValue({
      status: 'success',
      data: logs(),
      issues: [],
    } as Awaited<ReturnType<typeof executeFetchAuditLogRange>>);
  });

  it('keeps the trail away from roles without access', () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'viewer' } as ReturnType<typeof useAuth>);
    render(<AuditView />);
    expect(screen.queryByRole('heading', { name: 'Auditoría' })).not.toBeInTheDocument();
  });

  it('groups the day by patient with the period totals as category switches', async () => {
    await renderView();

    expect(executeFetchAuditLogRange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3000 })
    );
    expect(screen.getByRole('button', { name: /Cambios\s*2/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /Conexiones\s*1/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByText('María Rojas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revisar\s*1/ })).toBeInTheDocument();
  });

  it('shows what changed as before → after, with the technical record one click away', async () => {
    await renderView();

    fireEvent.click(screen.getByRole('button', { name: /José Pérez/ }));
    const line = await screen.findByText('Neumonía grave', undefined, { timeout: 5000 });
    expect(screen.getByText('Neumonía')).toBeInTheDocument();
    expect(screen.getAllByText('Ana Soto').length).toBeGreaterThan(0);

    expect(line).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detalle técnico' }));
    expect(screen.getByText('PATIENT_DIAGNOSIS_CHANGED')).toBeInTheDocument();
    expect(screen.queryByText(/never shown/)).not.toBeInTheDocument();
  });

  it('narrows to one staff member and to events that need review', async () => {
    await renderView();

    fireEvent.change(screen.getByRole('combobox', { name: 'Funcionario' }), {
      target: { value: 'luis.rojas@hospital.test' },
    });
    expect(screen.queryByText('José Pérez')).not.toBeInTheDocument();
    expect(screen.getByText('María Rojas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Revisar/ }));
    fireEvent.click(screen.getByRole('button', { name: /María Rojas/ }));
    expect(
      await screen.findByText('Cama liberada', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.queryByText('Vio ficha')).not.toBeInTheDocument();
  });

  it('shows connections with their timeline and remembers the chosen grouping', async () => {
    await renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Conexión' }));
    expect(
      await screen.findByText('Conexiones del día por funcionario', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
    const anaConnection = screen.getByRole('button', { name: /Ana Soto/ });
    expect(within(anaConnection).getByText('En curso')).toBeInTheDocument();
    expect(within(anaConnection).getByText(/Chrome · Windows/)).toBeInTheDocument();
    expect(screen.getByText('Sin conexión registrada')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUDIT_TRAIL_VIEW_STORAGE_KEY) || '{}')).toMatchObject({
      grouping: 'session',
    });
  });

  it('offers export and export keys to administrators', async () => {
    await renderView();

    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Claves Excel/ }));
    expect(screen.getByText('Panel de claves')).toBeInTheDocument();
  });

  it('says so when the period cannot be loaded', async () => {
    vi.mocked(executeFetchAuditLogRange).mockResolvedValue({
      status: 'failed',
      data: [],
      issues: [{ kind: 'unknown', message: 'sin conexión' }],
    } as Awaited<ReturnType<typeof executeFetchAuditLogRange>>);

    render(<AuditView />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la auditoría')
    );
  });
});
