import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

/**
 * Arranque del censo desde Eloísa.
 *
 * El día se acaba de crear vacío, así que su primera importación define la ocupación completa y
 * su diff es limpio por construcción (todos los pacientes son ingresos). Sin una exigencia propia
 * del intento, la política global `auto` lo aplicaría sin que nadie lo mire.
 */

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
  confirm: vi.fn(),
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

describe('RayenImportButton · inicio del día desde Eloísa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenImport.mockReturnValue({
      mode: 'auto',
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
      confirm: mocks.confirm,
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
        checkedAt: '2026-09-09T05:00:00.000Z',
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

  it('exige revisión humana del intento aunque la política global sea automática', async () => {
    render(<RayenImportButton autoStartRequestId={7} onAutoStartHandled={vi.fn()} />);

    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      reviewRequirement: 'day_bootstrap',
    });
    // Nunca se confirma sola: la revisión la abre el flujo, la cierra una persona.
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('consume la solicitud una sola vez y no repite la importación', async () => {
    const onAutoStartHandled = vi.fn();
    const { rerender } = render(
      <RayenImportButton autoStartRequestId={7} onAutoStartHandled={onAutoStartHandled} />
    );

    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(onAutoStartHandled).toHaveBeenCalledTimes(1);

    rerender(<RayenImportButton autoStartRequestId={7} onAutoStartHandled={onAutoStartHandled} />);
    expect(mocks.triggerImport).toHaveBeenCalledTimes(1);
  });

  it('no exige revisión adicional cuando la sincronización la inicia una persona', async () => {
    render(<RayenImportButton />);

    expect(mocks.triggerImport).not.toHaveBeenCalled();
    screen.getByTestId('rayen-import-button').click();

    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    // La política global gobierna sola: el intento manual no la endurece.
    expect(mocks.triggerImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined
    );
  });
});
