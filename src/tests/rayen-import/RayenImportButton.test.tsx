import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';

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
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
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
        version: '0.5.0',
        protocolVersion: 1,
        checkedAt: '2026-07-14T05:00:00.000Z',
        fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
        gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
      },
      message: 'Extensión Eloísa v0.5.0 operativa.',
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
    expect(screen.getByText('Conectada · v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('Ficha ✓')).toBeInTheDocument();
    expect(screen.getByText('Camas ✓')).toBeInTheDocument();
    expect(screen.getByText('Responsable')).toBeInTheDocument();
    expect(screen.getByText('Daniel Opazo')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('10/10 ✓')).toBeInTheDocument();
  });

  it('separates extension connectivity from the first successful synchronization', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada · v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización registrada')).toBeInTheDocument();
    expect(screen.getByText('Responsable')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('Sin registro')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización')).toBeInTheDocument();
  });

  it('distinguishes a completed census sync from uncalculated clinical coverage', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByText('Conectada · v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('No calculada')).toBeInTheDocument();
  });

  it('checks extension health before the existing reviewed synchronization action', async () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));

    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.refreshHealth).toHaveBeenCalledTimes(1);
  });

  it('shows a partial connection without blocking census synchronization', async () => {
    const degradedHealth = {
      connection: 'degraded',
      report: {
        version: '0.5.0',
        protocolVersion: 1,
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

    expect(screen.getByText('Conexión parcial · v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('Camas —')).toBeInTheDocument();
    expect(screen.getByTestId('rayen-extension-health-message')).toHaveTextContent(
      'validación de egresos será parcial'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
  });

  it('does not start the import when Ficha Médico is unavailable', async () => {
    const blockedHealth = {
      connection: 'blocked',
      report: {
        version: '0.5.0',
        protocolVersion: 1,
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
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));

    await waitFor(() => expect(mocks.refreshHealth).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });
});
