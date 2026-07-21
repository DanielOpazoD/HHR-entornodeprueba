import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
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
      error: null,
      staffingProposal: null,
      isStaffingProposalBusy: false,
      staffingProposalError: null,
      triggerImport: mocks.triggerImport,
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

  it('presents Eloísa as an operational source with visible provenance', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 10,
      total: 10,
      errors: 0,
      lastCompletedAt: '2026-07-13T18:33:00.000Z',
    });

    render(<RayenImportButton />);

    expect(screen.getByTestId('rayen-operations-bar')).toBeInTheDocument();
    expect(screen.getByText('Fuente clínica externa')).toBeInTheDocument();
    expect(screen.getByText('Conectada · v0.6.0')).toBeInTheDocument();
    expect(screen.getByText('Ficha ✓')).toBeInTheDocument();
    expect(screen.getByText('Camas ✓')).toBeInTheDocument();
    expect(screen.queryByText('Responsable')).not.toBeInTheDocument();
    expect(screen.queryByText('Daniel Opazo')).not.toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('10/10 ✓')).toBeInTheDocument();

    const detailsButton = screen.getByRole('button', {
      name: 'Ver información de la última sincronización',
    });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Detalle de la última sincronización' })).toHaveTextContent(
      'ResponsableDaniel Opazo'
    );
  });

  it('separates extension connectivity from the first successful synchronization', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada · v0.6.0')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización registrada')).toBeInTheDocument();
    expect(screen.queryByText('Responsable')).not.toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver información de la última sincronización' })
    );
    expect(
      screen.getByRole('region', { name: 'Detalle de la última sincronización' })
    ).toHaveTextContent('ResponsableSin registro');
  });

  it('distinguishes a legacy census sync from persisted clinical coverage', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada · v0.6.0')).toBeInTheDocument();
    expect(screen.getByText('No disponible en sincronizaciones antiguas')).toBeInTheDocument();
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

  it('shows a partial connection without blocking census synchronization', async () => {
    const degradedHealth = {
      connection: 'degraded',
      report: {
        version: '0.6.0',
        protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
        checkedAt: '2026-07-14T05:00:00.000Z',
        fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
        gestionCamas: { status: 'missing', message: 'Gestión de Camas no está abierta.' },
      },
      message:
        'Gestión de Camas no está abierta. El censo puede sincronizarse, pero la validación de egresos será parcial.',
      canSync: true,
    };
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenExtensionHealth.mockReturnValue({
      ...degradedHealth,
      refresh: mocks.refreshHealth,
    });
    mocks.refreshHealth.mockResolvedValue(degradedHealth);

    render(<RayenImportButton />);

    expect(screen.getByText('Parcial · v0.6.0')).toBeInTheDocument();
    expect(screen.getByText('Camas —')).toBeInTheDocument();
    expect(screen.queryByTestId('rayen-extension-health-message')).not.toBeInTheDocument();
    expect(screen.getByTestId('rayen-extension-health-help')).toHaveAttribute(
      'title',
      expect.stringContaining('validación de egresos será parcial')
    );
    fireEvent.click(screen.getByTestId('rayen-extension-health-help'));
    expect(
      screen.getByText(
        'Gestión de Camas no está abierta. El censo puede sincronizarse, pero la validación de egresos será parcial.'
      )
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar parcial' }));
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
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
    fireEvent.click(screen.getByRole('button', { name: 'Revisar Ficha Médico' }));

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

    expect(screen.getByText('10/11 · 1 pendiente')).toBeInTheDocument();
    expect(screen.getByText('· Parcial')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'Comprobando…' })).toHaveClass('w-[10.75rem]');
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
      name: 'Sincronización de datos clínicos',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByTestId('rayen-fill-status')).toHaveTextContent('Datos clínicos50%');
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent('4/8');
  });

  it('closes synchronization details with Escape and restores trigger focus', async () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });

    render(<RayenImportButton />);
    const detailsButton = screen.getByRole('button', {
      name: 'Ver información de la última sincronización',
    });
    fireEvent.click(detailsButton);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(
      screen.queryByRole('region', { name: 'Detalle de la última sincronización' })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(detailsButton).toHaveFocus());
  });

  it('keeps a completed-change summary in the history instead of expanding the toolbar', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      result: {
        applied: { admissions: 1, updates: 0, moves: 0, discharges: 0 },
        skipped: [],
      },
      error: null,
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });

    render(<RayenImportButton />);

    expect(screen.queryByTestId('rayen-import-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent(
      'Sincronizado: 1 ingresos'
    );
  });

  it('keeps an import error compact until its accessible detail is requested', () => {
    const error = 'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen.';
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      result: null,
      error,
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });

    render(<RayenImportButton />);

    const notice = screen.getByTestId('rayen-import-error');
    expect(notice).toHaveClass('flex-wrap');
    expect(screen.queryByText(error)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `Ver detalle de sincronización. ${error}` })
    );
    expect(screen.getByText(error)).toBeVisible();
  });
});
