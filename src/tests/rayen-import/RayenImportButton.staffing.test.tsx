import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';

const mocks = vi.hoisted(() => ({
  useRayenImport: vi.fn(),
  refreshExtension: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: {} }),
}));

vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => ({ running: false, done: 0, total: 0, errors: 0 }),
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
    connection: 'ready',
    report: null,
    message: 'Extensión operativa.',
    canSync: true,
    refresh: mocks.refreshExtension,
  }),
}));

vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));
vi.mock('@/features/rayen-import/components/RayenImportFlowStatus', () => ({
  RayenImportFlowStatus: () => null,
}));
vi.mock('@/features/rayen-import/components/RayenSyncHistoryModal', () => ({
  RayenSyncHistoryModal: () => null,
}));
vi.mock('@/features/rayen-import/components/RayenNursingShiftProposalModal', () => ({
  RayenNursingShiftProposalModal: ({
    proposal,
    onConfirm,
  }: {
    proposal: unknown;
    onConfirm: () => void;
  }) =>
    proposal ? (
      <div role="dialog" aria-label="Dotación clínica identificada">
        <button type="button" onClick={onConfirm}>
          Aplicar propuesta
        </button>
      </div>
    ) : null,
}));

describe('RayenImportButton staffing review', () => {
  beforeEach(() => {
    mocks.refreshExtension.mockResolvedValue({
      connection: 'ready',
      report: null,
      message: 'Extensión operativa.',
      canSync: true,
    });
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      result: null,
      hasSkippedItems: false,
      error: null,
      staffingProposal: { censusDate: '2026-08-07' },
      isStaffingProposalBusy: false,
      staffingProposalError: null,
      refreshStaffingProposal: vi.fn(async () => ({ censusDate: '2026-08-07' })),
      triggerImport: vi.fn(),
      retryClinicalFill: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
      confirmStaffingProposal: vi.fn(async () => true),
      dismissStaffingProposal: vi.fn(),
    });
  });

  it('refreshes staffing explicitly without blocking the main synchronization action', async () => {
    render(<RayenImportButton />);

    expect(screen.queryByRole('dialog', { name: /dotación clínica identificada/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar dotación clínica' }));

    expect(
      await screen.findByRole('dialog', { name: /dotación clínica identificada/i })
    ).toBeVisible();
  });

  it('requires only Ficha Medico for the independent staffing read', async () => {
    mocks.refreshExtension.mockResolvedValue({
      connection: 'blocked',
      report: {
        fichaMedico: { status: 'ready' },
        gestionCamas: { status: 'missing' },
      },
      message: 'Gestión de Camas no está conectada.',
      canSync: false,
    });
    const refreshStaffingProposal = vi.fn(async () => ({ censusDate: '2026-08-07' }));
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      refreshStaffingProposal,
    });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar dotación clínica' }));

    await waitFor(() => expect(refreshStaffingProposal).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole('dialog', { name: /dotación clínica identificada/i })
    ).toBeVisible();
  });

  it('keeps the staffing review open when applying the proposal fails', async () => {
    const confirmStaffingProposal = vi.fn(async () => false);
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      confirmStaffingProposal,
    });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar dotación clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar propuesta' }));

    await waitFor(() => expect(confirmStaffingProposal).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: /dotación clínica identificada/i })).toBeVisible();
  });

  it('closes the staffing review only after a confirmed application', async () => {
    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar dotación clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar propuesta' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /dotación clínica identificada/i })).toBeNull()
    );
  });
});
