import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
  retryClinicalFill: vi.fn(),
  useDailyRecordData: vi.fn(),
  useRayenImport: vi.fn(),
  useRayenFillProgress: vi.fn(),
  useRayenExtensionHealth: vi.fn(),
  refreshHealth: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mocks.useDailyRecordData(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => mocks.useRayenFillProgress(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => mocks.useRayenExtensionHealth(),
}));

vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      execution: null,
      diff: null,
      isPreviewOpen: false,
      result: null,
      error: null,
      staffingProposal: null,
      isStaffingProposalBusy: false,
      staffingProposalError: null,
      triggerImport: mocks.triggerImport,
      retryClinicalFill: mocks.retryClinicalFill,
      confirm: vi.fn(),
      cancel: vi.fn(),
      confirmStaffingProposal: vi.fn(),
      dismissStaffingProposal: vi.fn(),
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 0,
      total: 0,
      errors: 0,
      lastCompletedAt: null,
      outcome: null,
      attemptId: null,
      staffingOutcome: null,
    });
    const readyHealth = {
      connection: 'ready',
      report: {
        version: '0.6.0',
        protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
        checkedAt: '2026-07-14T05:00:00.000Z',
        fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
        gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
      },
      message: 'Extensión Eloísa v0.6.0 operativa.',
      canSync: true,
    };
    mocks.refreshHealth.mockResolvedValue(readyHealth);
    mocks.useRayenExtensionHealth.mockReturnValue({
      ...readyHealth,
      refresh: mocks.refreshHealth,
    });
  });

  it('keeps provenance in history while the operational source stays compact', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
        rayenSyncHistory: [
          {
            id: 'run-provenance',
            startedAt: '2026-07-13T18:32:00.000Z',
            completedAt: '2026-07-13T18:33:00.000Z',
            by: 'Daniel Opazo',
            status: 'applied',
            coverage: {
              total: 10,
              completed: 10,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-07-13T18:33:00.000Z',
            },
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
            source: {
              extensionVersion: '0.6.0',
              fichaMedico: 'ready',
              gestionCamas: 'ready',
            },
          },
        ],
      },
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 10,
      total: 10,
      errors: 0,
      lastCompletedAt: '2026-07-13T18:33:00.000Z',
      outcome: 'complete',
      attemptId: 'run-provenance',
      staffingOutcome: 'complete',
    });

    render(<RayenImportButton />);

    expect(screen.getByTestId('rayen-operations-bar')).toBeInTheDocument();
    expect(screen.queryByText('Fuente clínica externa')).not.toBeInTheDocument();
    expect(screen.getByText('Conectada')).toBeInTheDocument();
    expect(screen.getByText('Última 13-07-2026 · 12:32 h')).toBeInTheDocument();
    expect(screen.queryByText('Ficha ✓')).not.toBeInTheDocument();
    expect(screen.queryByText('Camas ✓')).not.toBeInTheDocument();
    expect(screen.queryByText(/v0\.6\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText('Responsable')).not.toBeInTheDocument();
    expect(screen.queryByText('Daniel Opazo')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ver información de la última sincronización' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    expect(screen.getByRole('dialog', { name: 'Historial de sincronización · hoy' })).toBeVisible();
    expect(screen.getByText('Daniel Opazo')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica: 10/10 completa')).toBeInTheDocument();
    expect(screen.getByText('Ext. v0.6.0 · Ficha ✓ · Camas ✓')).toBeInTheDocument();
  });

  it('separates extension connectivity from the first successful synchronization', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada')).toBeInTheDocument();
    expect(screen.getByText('Listo para sincronizar')).toBeInTheDocument();
    expect(screen.queryByText('Responsable')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    expect(screen.getByText('Sin sincronizaciones registradas')).toBeInTheDocument();
  });

  it('projects the route-selected date while its replacement record is still loading', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        date: '2026-08-07',
        rayenSyncHistory: [
          {
            id: 'run-stale-date',
            startedAt: '2026-08-07T18:32:00.000Z',
            completedAt: '2026-08-07T18:33:00.000Z',
            by: 'Profesional del día anterior',
            status: 'applied',
            coverage: {
              total: 1,
              completed: 1,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-08-07T18:33:00.000Z',
            },
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 1 },
            source: {
              extensionVersion: '0.6.0',
              fichaMedico: 'ready',
              gestionCamas: 'ready',
            },
          },
        ],
      },
    });

    render(<RayenImportButton selectedDate="2026-08-08" />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));

    expect(
      screen.getByRole('dialog', { name: 'Historial de sincronización · 08-08-2026' })
    ).toBeVisible();
    expect(screen.getByText('Sin sincronizaciones registradas')).toBeInTheDocument();
    expect(screen.queryByText('Profesional del día anterior')).not.toBeInTheDocument();
  });

  it('keeps a terminal execution labelled with the date it actually synchronized', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: { date: '2026-08-08' } });
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      execution: {
        context: {
          runId: 'run-old-date',
          requestId: 'request-old-date',
          selectedDate: '2026-08-07',
        },
        pending: { runId: 'run-old-date', selectedDate: '2026-08-07' },
        stage: { type: 'complete' },
        outcome: { structuralConflicts: 0, skippedItems: 0 },
      },
    });

    render(<RayenImportButton selectedDate="2026-08-08" />);

    expect(screen.getByText('Todo al día · 07-08-2026')).toBeInTheDocument();
  });

  it('does not recreate legacy provenance outside the versioned history', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveClass('sr-only');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Última sincronización sin evidencia clínica'
    );
    expect(
      screen.queryByRole('progressbar', { name: 'Progreso de sincronización con Eloísa' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Daniel Opazo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    expect(screen.getByText('Sin sincronizaciones registradas')).toBeInTheDocument();
  });

  it('checks extension health before the existing reviewed synchronization action', async () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));

    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.refreshHealth).toHaveBeenCalledTimes(1);
    expect(mocks.triggerImport).toHaveBeenCalledWith(
      expect.objectContaining({ connection: 'ready', canSync: true }),
      expect.objectContaining({
        stagesMs: { preflight: expect.any(Number) },
        counters: { requests: 1 },
      })
    );
  });

  it('blocks census synchronization when Gestión de Camas is unavailable', async () => {
    const blockedHealth = {
      connection: 'blocked',
      report: {
        version: '0.6.0',
        protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
        checkedAt: '2026-07-14T05:00:00.000Z',
        fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
        gestionCamas: { status: 'missing', message: 'Gestión de Camas no está abierta.' },
      },
      message:
        'Gestión de Camas no está abierta. Se requieren Ficha Médico y Gestión de Camas para sincronizar.',
      canSync: false,
    };
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenExtensionHealth.mockReturnValue({
      ...blockedHealth,
      refresh: mocks.refreshHealth,
    });
    mocks.refreshHealth.mockResolvedValue(blockedHealth);

    render(<RayenImportButton />);

    expect(screen.getByText('Conectar Gestión de Camas')).toBeInTheDocument();
    expect(screen.queryByText('Camas —')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rayen-extension-health-message')).not.toBeInTheDocument();
    const connectionStatus = screen
      .getAllByRole('status')
      .find(
        element => element.textContent === `Eloísa requiere atención. ${blockedHealth.message}`
      );
    expect(connectionStatus).toBeDefined();
    expect(connectionStatus).toHaveClass('sr-only');
    expect(screen.getByTestId('rayen-extension-health-help')).toHaveAttribute(
      'title',
      expect.stringContaining('Se requieren Ficha Médico y Gestión de Camas')
    );
    fireEvent.click(screen.getByTestId('rayen-extension-health-help'));
    expect(screen.getByTestId('rayen-operations-bar')).toHaveClass('relative', 'z-[39]');
    expect(
      screen.getByText(
        'Gestión de Camas no está abierta. Se requieren Ficha Médico y Gestión de Camas para sincronizar.'
      )
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar conexión' }));
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(
      expect.objectContaining({ canSync: false }),
      expect.objectContaining({ counters: { requests: 1 } })
    );
  });

  it('records the deliberate attempt when Ficha Médico is unavailable', async () => {
    const blockedHealth = {
      connection: 'blocked',
      report: {
        version: '0.6.0',
        protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
        checkedAt: '2026-07-14T05:00:00.000Z',
        fichaMedico: { status: 'missing', message: 'Abre Ficha Médico e inicia sesión.' },
        gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
      },
      message: 'Abre Ficha Médico e inicia sesión.',
      canSync: false,
    };
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenExtensionHealth.mockReturnValue({
      ...blockedHealth,
      refresh: mocks.refreshHealth,
    });
    mocks.refreshHealth.mockResolvedValue(blockedHealth);

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar conexión' }));

    await waitFor(() => expect(mocks.refreshHealth).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(
      blockedHealth,
      expect.objectContaining({ counters: { requests: 1 } })
    );
  });

  it('explains a partial result and retries through the existing reviewed flow', async () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-14T10:00:00.000Z',
          by: 'Daniel Opazo',
          runId: 'run-1',
          status: 'partial',
          coverage: {
            total: 11,
            completed: 10,
            errors: 1,
            sourceErrors: 1,
            completedAt: '2026-07-14T10:03:00.000Z',
          },
        },
        rayenSyncHistory: [
          {
            id: 'run-1',
            startedAt: '2026-07-14T10:00:00.000Z',
            completedAt: '2026-07-14T10:03:00.000Z',
            by: 'Daniel Opazo',
            status: 'partial',
            structuralReview: {
              structureConfirmed: true,
              historicalCorrectionsPending: false,
              historicalCorrectionsRequireFreshCapture: false,
              isolatedConflicts: 0,
            },
            coverage: {
              total: 11,
              completed: 10,
              errors: 1,
              sourceErrors: 1,
              completedAt: '2026-07-14T10:03:00.000Z',
            },
            changes: { admissions: 1, updates: 2, moves: 0, discharges: 0, unchanged: 8 },
            source: { fichaMedico: 'ready', gestionCamas: 'ready' },
          },
        ],
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Última sincronización con observaciones');
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    const historyButton = screen.getByRole('button', {
      name: 'Abrir historial de sincronización del día, 1 eventos',
    });
    expect(historyButton).not.toHaveTextContent('Historial');
    expect(historyButton).toHaveAttribute('title', 'Historial de sincronización · 1 evento');
    fireEvent.click(historyButton);
    expect(screen.getByRole('dialog', { name: 'Historial de sincronización · hoy' })).toBeVisible();
    expect(
      screen.getByText('Sincronizado: 1 ingresos, 2 act., 0 mov., 0 egresos')
    ).toBeInTheDocument();
    expect(screen.getByText('Parcial')).toBeInTheDocument();
    expect(screen.getAllByText(/1 paciente no se pudo completar/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Esta ejecución no registró el paciente ni la etapa que falló/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Información clínica pendiente')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar información clínica' }));
    expect(screen.getByRole('button', { name: 'Sincronizando…' })).toBeDisabled();
    await waitFor(() => expect(mocks.retryClinicalFill).toHaveBeenCalledTimes(1));
    expect(mocks.refreshHealth).not.toHaveBeenCalled();
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

});
