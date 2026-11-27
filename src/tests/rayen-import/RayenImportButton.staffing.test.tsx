import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import {
  createIdleRayenFillProgress,
  createRayenImportState,
  createReadyRayenExtensionHealth,
} from './rayenImportButtonTestFixtures';

const mocks = vi.hoisted(() => ({
  useRayenImport: vi.fn(),
  refreshExtension: vi.fn(),
  useDailyRecordData: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mocks.useDailyRecordData(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => createIdleRayenFillProgress(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
    ...createReadyRayenExtensionHealth({ report: null, message: 'Extensión operativa.' }),
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
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.refreshExtension.mockResolvedValue(
      createReadyRayenExtensionHealth({ report: null, message: 'Extensión operativa.' })
    );
    mocks.useRayenImport.mockReturnValue(
      createRayenImportState({
        hasSkippedItems: false,
        staffingProposal: { censusDate: '2026-08-07' },
        refreshStaffingProposal: vi.fn(async () => ({ censusDate: '2026-08-07' })),
        confirmStaffingProposal: vi.fn(async () => true),
      })
    );
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

  it('waits for the selected census record before reading staffing', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: { date: '2026-08-07' } });
    const refreshStaffingProposal = vi.fn();
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      refreshStaffingProposal,
    });

    render(<RayenImportButton selectedDate="2026-08-08" />);

    expect(screen.getByRole('button', { name: 'Sincronizar dotación clínica' })).toBeDisabled();
    expect(refreshStaffingProposal).not.toHaveBeenCalled();
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
