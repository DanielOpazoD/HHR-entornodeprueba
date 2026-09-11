import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
  refreshHealth: vi.fn(),
  useRayenImport: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: {} }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => ({
    running: false,
    done: 0,
    total: 0,
    errors: 0,
    outcome: null,
    attemptId: null,
    staffingOutcome: null,
  }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
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
    refresh: mocks.refreshHealth,
  }),
}));
vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

const importState = (policyStatus: 'ready' | 'loading' | 'unauthorized') => ({
  mode: 'preview',
  policyStatus,
  policyBlockReason: null,
  execution: null,
  diff: null,
  isPreviewOpen: false,
  result: null,
  error: null,
  staffingProposal: null,
  isStaffingProposalBusy: false,
  staffingProposalError: null,
  triggerImport: mocks.triggerImport,
  retryClinicalFill: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  confirmStaffingProposal: vi.fn(),
  dismissStaffingProposal: vi.fn(),
});

describe('RayenImportButton policy readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshHealth.mockResolvedValue({ canSync: true });
  });

  it('blocks synchronization when policy access is unauthorized', () => {
    mocks.useRayenImport.mockReturnValue({
      ...importState('unauthorized'),
      policyBlockReason:
        'Tu sesión perdió permisos para leer la política global. Vuelve a iniciar sesión para sincronizar.',
    });

    render(<RayenImportButton />);

    const syncButton = screen.getByTestId('rayen-import-button');
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute('title', expect.stringContaining('Vuelve a iniciar sesión'));
    fireEvent.click(syncButton);
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

  it('waits for the global policy instead of spending capture while it loads', async () => {
    mocks.useRayenImport.mockReturnValue(importState('loading'));
    const { rerender } = render(<RayenImportButton />);

    const loadingButton = screen.getByTestId('rayen-import-button');
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('title', expect.stringContaining('aún se está cargando'));
    fireEvent.click(loadingButton);
    expect(mocks.refreshHealth).not.toHaveBeenCalled();
    expect(mocks.triggerImport).not.toHaveBeenCalled();

    mocks.useRayenImport.mockReturnValue(importState('ready'));
    rerender(<RayenImportButton />);

    const readyButton = screen.getByTestId('rayen-import-button');
    expect(readyButton).toBeEnabled();
    fireEvent.click(readyButton);
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
  });
});
