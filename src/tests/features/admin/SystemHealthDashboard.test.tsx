import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserHealthStatus } from '@/services/admin/healthService';
import { SystemHealthDashboard } from '@/features/admin/components/SystemHealthDashboard';

const mocks = vi.hoisted(() => ({
  deleteUserHealthSnapshot: vi.fn(),
  reopenSystemHealthIncident: vi.fn(),
  resolveSystemHealthIncident: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  authRole: vi.fn(() => 'admin'),
}));

// @flake-safe: Date.now only keeps fixture incidents recent relative to the test run.
const timestampMinutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

const recentIncidentTimestamp = timestampMinutesAgo(20);
const recentLastSeenTimestamp = timestampMinutesAgo(10);

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin User',
    },
    role: mocks.authRole(),
  }),
}));

const userStatus: UserHealthStatus = {
  uid: 'u1',
  email: 'user@example.com',
  displayName: 'User Example',
  lastSeen: recentLastSeenTimestamp,
  isOnline: true,
  isOutdated: false,
  pendingMutations: 0,
  pendingSyncTasks: 0,
  failedSyncTasks: 1,
  conflictSyncTasks: 1,
  retryingSyncTasks: 0,
  syncOrphanedTasks: 0,
  oldestPendingAgeMs: 0,
  remoteSyncReason: 'ready',
  versionUpdateReason: 'current',
  localErrorCount: 1,
  degradedLocalPersistence: false,
  repositoryWarningCount: 0,
  slowestRepositoryOperationMs: 0,
  operationalObservedCount: 1,
  operationalFailureCount: 1,
  operationalRetryableCount: 0,
  operationalRecoverableCount: 0,
  operationalDegradedCount: 0,
  operationalBlockedCount: 1,
  operationalUnauthorizedCount: 0,
  operationalLastHourObservedCount: 1,
  operationalSyncObservedCount: 1,
  operationalIndexedDbObservedCount: 0,
  operationalClinicalDocumentObservedCount: 0,
  operationalCreateDayObservedCount: 0,
  operationalHandoffObservedCount: 0,
  operationalExportBackupObservedCount: 0,
  operationalDailyRecordRecoveredRealtimeNullCount: 0,
  operationalDailyRecordConfirmedRealtimeNullCount: 0,
  operationalSyncReadUnavailableCount: 0,
  operationalIndexedDbFallbackModeCount: 0,
  operationalAuthBootstrapTimeoutCount: 0,
  operationalTopObservedCategory: 'sync',
  operationalTopObservedOperation: 'daily_record_remote_write',
  latestOperationalOperation: 'daily_record_remote_write',
  latestOperationalRuntimeState: 'blocked',
  latestOperationalIssueAt: recentIncidentTimestamp,
  recentEvents: [
    {
      id: 'event-1',
      source: 'operational',
      category: 'sync',
      severity: 'critical',
      status: 'open',
      timestamp: recentIncidentTimestamp,
      message: 'Escritura remota bloqueada',
      operation: 'daily_record_remote_write',
      module: 'Censo diario',
      action: 'Guardar dia',
      route: '/censo',
      runtimeState: 'blocked',
      issues: ['permission-denied'],
      contextSummary: [
        'fecha clinica: 2026-05-21',
        'cama: Cama R1',
        'campo: Diagnostico',
        'tipo: UPDATE_PATIENT',
      ],
    },
  ],
  appVersion: 'v1',
  platform: 'MacIntel',
  userAgent: 'Vitest',
};

vi.mock('@/services/admin/healthService', async () => {
  const actual = await vi.importActual<typeof import('@/services/admin/healthService')>(
    '@/services/admin/healthService'
  );
  return {
    ...actual,
    subscribeToSystemHealth: (onUpdate: (data: UserHealthStatus[]) => void) => {
      onUpdate([userStatus]);
      return vi.fn();
    },
    subscribeToSystemHealthIncidentResolutions: (
      onUpdate: (data: Record<string, unknown>) => void
    ) => {
      onUpdate({});
      return vi.fn();
    },
    deleteUserHealthSnapshot: mocks.deleteUserHealthSnapshot,
    reopenSystemHealthIncident: mocks.reopenSystemHealthIncident,
    resolveSystemHealthIncident: mocks.resolveSystemHealthIncident,
  };
});

describe('SystemHealthDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.authRole.mockReturnValue('admin');
    mocks.resolveSystemHealthIncident.mockResolvedValue(undefined);
    mocks.reopenSystemHealthIncident.mockResolvedValue(undefined);
  });

  it('shows filters, actionable incident detail and delete snapshot action', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteUserHealthSnapshot.mockResolvedValue(undefined);

    render(<SystemHealthDashboard />);

    expect(
      await screen.findByPlaceholderText('Buscar usuario, modulo, cama o campo...')
    ).toBeInTheDocument();
    expect(screen.queryByText('Causas agrupadas')).not.toBeInTheDocument();
    expect(screen.queryByText('Linea temporal')).not.toBeInTheDocument();
    expect(screen.queryByText('Checklist Diario (Soporte)')).not.toBeInTheDocument();
    expect(screen.queryByText('Alertas Operativas')).not.toBeInTheDocument();
    expect(screen.queryByText('Incidencias abiertas')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar CSV/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Marcar visibles resueltos/i })).toBeInTheDocument();
    expect(screen.getByText('Incidencias activas')).toBeInTheDocument();
    expect(screen.getByText('Incidencia accionable')).toBeInTheDocument();
    expect(screen.queryByText('Usuarios afectados')).not.toBeInTheDocument();
    expect(screen.queryByText('Incidentes')).not.toBeInTheDocument();
    expect(screen.queryByText('Resueltos')).not.toBeInTheDocument();
    expect(screen.getByText('Ultimas 24 h')).toBeInTheDocument();
    expect(screen.getByText('Detalle operativo')).toBeInTheDocument();
    expect(screen.getAllByText('Escritura remota bloqueada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Censo diario / daily_record_remote_write').length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByText('Guardar dia').length).toBeGreaterThan(0);
    expect(screen.getByText('/censo')).toBeInTheDocument();
    expect(screen.getByText('fecha clinica: 2026-05-21')).toBeInTheDocument();
    expect(screen.getByText('cama: Cama R1')).toBeInTheDocument();
    expect(screen.getByText('campo: Diagnostico')).toBeInTheDocument();
    expect(screen.getByText('tipo: UPDATE_PATIENT')).toBeInTheDocument();
    expect(screen.queryByText('Detalle')).not.toBeInTheDocument();

    await userEvent.type(
      screen.getAllByPlaceholderText('Nota de resolucion...')[0],
      'Permiso corregido'
    );
    await userEvent.click(screen.getAllByRole('button', { name: /Marcar resuelto/i })[0]);

    await waitFor(() =>
      expect(mocks.resolveSystemHealthIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          actor: expect.objectContaining({
            uid: 'admin-1',
            email: 'admin@example.com',
            displayName: 'Admin User',
          }),
          note: 'Permiso corregido',
        })
      )
    );
    expect((await screen.findAllByText('Resuelto')).length).toBeGreaterThan(0);
    expect(screen.getByText('Historial de resolucion')).toBeInTheDocument();
    expect(screen.getAllByText(/Admin User/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Permiso corregido/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Reabrir/i }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: /Reabrir/i })[0]);

    await waitFor(() =>
      expect(mocks.reopenSystemHealthIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          actor: expect.objectContaining({
            uid: 'admin-1',
          }),
        })
      )
    );

    expect(
      (await screen.findAllByRole('button', { name: /Marcar resuelto/i })).length
    ).toBeGreaterThan(0);

    await userEvent.click(screen.getByTitle('Borrar registro de salud'));

    await waitFor(() => expect(mocks.deleteUserHealthSnapshot).toHaveBeenCalledWith('u1'));
    expect(mocks.success).toHaveBeenCalledWith('Registro de salud borrado', 'user@example.com');
  });

  it('marks all visible open incidents as resolved in bulk', async () => {
    render(<SystemHealthDashboard />);

    expect(
      await screen.findByPlaceholderText('Buscar usuario, modulo, cama o campo...')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Marcar visibles resueltos/i }));

    await waitFor(() =>
      expect(mocks.resolveSystemHealthIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          note: 'Cierre operacional masivo desde Salud de usuarios',
        })
      )
    );
    expect(mocks.resolveSystemHealthIncident).toHaveBeenCalledTimes(3);
    expect(mocks.success).toHaveBeenCalledWith('Incidentes visibles marcados como resueltos', '3');
  });

  it('restores visible incidents when bulk resolve cannot be persisted', async () => {
    mocks.resolveSystemHealthIncident.mockRejectedValueOnce(new Error('permission-denied'));

    render(<SystemHealthDashboard />);

    expect(
      await screen.findByPlaceholderText('Buscar usuario, modulo, cama o campo...')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Marcar visibles resueltos/i }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'No se pudieron resolver los incidentes visibles',
        'Error: permission-denied'
      )
    );
    expect(screen.getAllByRole('button', { name: /Marcar resuelto/i }).length).toBeGreaterThan(0);
  });

  it('keeps health maintenance actions admin-only for clinical operators', async () => {
    mocks.authRole.mockReturnValue('nurse_hospital');

    render(<SystemHealthDashboard />);

    expect(
      await screen.findByPlaceholderText('Buscar usuario, modulo, cama o campo...')
    ).toBeInTheDocument();
    expect(screen.getByText('Incidencias activas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar CSV/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Marcar visibles resueltos/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar resuelto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reabrir/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Borrar registro de salud')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Requiere rol admin/i).length).toBeGreaterThan(0);
  });

  it('filters incidents by clinical bed context and clears the selected user window', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteUserHealthSnapshot.mockResolvedValue(undefined);

    render(<SystemHealthDashboard />);

    await userEvent.type(
      await screen.findByPlaceholderText('Buscar usuario, modulo, cama o campo...'),
      'Diagnostico'
    );

    expect(screen.getAllByText('Escritura remota bloqueada').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /Limpiar usuario/i }));

    await waitFor(() =>
      expect(mocks.resolveSystemHealthIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          note: 'Borrón y cuenta nueva para el usuario desde Salud de usuarios',
        })
      )
    );
    expect(mocks.deleteUserHealthSnapshot).toHaveBeenCalledWith('u1');
    expect(mocks.success).toHaveBeenCalledWith('Usuario limpiado desde ahora', 'user@example.com');
  });
});
