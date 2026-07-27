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
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      result: null,
      hasSkippedItems: false,
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
    expect(screen.getByTitle('Signos vitales: Sin evidencia')).toBeInTheDocument();
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
      expect.objectContaining({ connection: 'ready', canSync: true })
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
    expect(screen.getByTestId('rayen-extension-health-help')).toHaveAttribute(
      'title',
      expect.stringContaining('Se requieren Ficha Médico y Gestión de Camas')
    );
    fireEvent.click(screen.getByTestId('rayen-extension-health-help'));
    expect(
      screen.getByText(
        'Gestión de Camas no está abierta. Se requieren Ficha Médico y Gestión de Camas para sincronizar.'
      )
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar conexión' }));
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(expect.objectContaining({ canSync: false }));
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
    expect(mocks.triggerImport).toHaveBeenCalledWith(blockedHealth);
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
    expect(screen.getByTitle('Signos vitales: Con observaciones')).toBeInTheDocument();
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
    expect(screen.getByText('Puedes completar esta sincronización')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar con revisión' }));
    expect(screen.getByRole('button', { name: 'Sincronizando…' })).toBeDisabled();
    await waitFor(() => expect(mocks.refreshHealth).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(
      expect.objectContaining({ connection: 'ready', canSync: true })
    );
  });

  it('keeps complete clinical coverage separate from a partial Camas source', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSyncHistory: [
          {
            id: 'run-camas',
            startedAt: '2026-07-14T10:00:00.000Z',
            completedAt: '2026-07-14T10:03:00.000Z',
            by: 'Daniel Opazo',
            status: 'partial',
            coverage: {
              total: 11,
              completed: 11,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-07-14T10:03:00.000Z',
            },
            source: { fichaMedico: 'ready', gestionCamas: 'missing' },
          },
        ],
      },
    });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));

    expect(screen.getByText('Gestión de Camas no disponible')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica: 11/11 completa')).toHaveClass('text-emerald-700');
  });

  it('resumes an applied clinical fill without requesting the census snapshot again', async () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-14T10:00:00.000Z',
          by: 'Daniel Opazo',
          runId: 'run-applied',
          status: 'applied',
        },
        rayenSyncHistory: [
          {
            id: 'run-applied',
            startedAt: '2026-07-14T10:00:00.000Z',
            by: 'Daniel Opazo',
            status: 'applied',
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
          },
        ],
      },
    });
    mocks.retryClinicalFill.mockResolvedValue(undefined);

    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar con revisión' }));

    await waitFor(() => expect(mocks.retryClinicalFill).toHaveBeenCalledOnce());
    expect(mocks.refreshHealth).not.toHaveBeenCalled();
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

  it('shows the empty history state, closes with Escape and restores focus', async () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    render(<RayenImportButton />);

    const historyButton = screen.getByRole('button', {
      name: 'Abrir historial de sincronización del día, 0 eventos',
    });
    historyButton.focus();
    fireEvent.click(historyButton);
    expect(screen.getByText('Sin sincronizaciones registradas')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Historial de sincronización · hoy' })).toBeNull();
    await waitFor(() => expect(historyButton).toHaveFocus());
  });

  it('keeps the primary action width stable while the connection is checked', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenExtensionHealth.mockReturnValue({
      connection: 'checking',
      report: null,
      message: 'Comprobando conexión con la extensión.',
      canSync: false,
      refresh: mocks.refreshHealth,
    });

    render(<RayenImportButton />);

    expect(screen.getByRole('button', { name: 'Comprobando…' })).toHaveClass('w-40');
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent('Sincronizado:');
  });

  it('shows real clinical-fill progress as an accessible percentage bar', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      done: 4,
      total: 8,
      errors: 0,
      lastCompletedAt: null,
    });

    render(<RayenImportButton />);

    const progress = screen.getByRole('progressbar', {
      name: 'Progreso de sincronización con Eloísa',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByTestId('rayen-sync-pulse')).toHaveTextContent(
      'Revisando información clínica · 68%'
    );
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent('4/8');
  });

  it('integrates the contextual attention action in the same compact bar', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton attentionControl={<button type="button">1 escala</button>} />);

    const bar = screen.getByTestId('rayen-operations-bar');
    expect(bar).toContainElement(screen.getByRole('button', { name: '1 escala' }));
    expect(bar.firstElementChild).toHaveClass(
      'xl:grid-cols-[minmax(190px,0.72fr)_minmax(0,2.25fr)_auto]'
    );
    expect(bar.firstElementChild).not.toHaveClass(
      'md:grid-cols-[minmax(210px,0.72fr)_minmax(520px,2.25fr)_auto]'
    );
  });
});
