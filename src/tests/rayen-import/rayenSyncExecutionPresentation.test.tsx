import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

describe('Rayen contextual synchronization presentation', () => {
  it('keeps the selected historical census date visible in review', () => {
    render(
      <RayenImportPreviewModal
        isOpen
        diff={null}
        isBusy={false}
        error={null}
        targetDate="2026-08-01"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId('rayen-import-target-date')).toHaveTextContent(
      'Censo del 01-08-2026'
    );
  });

  it('labels history with the selected census date instead of today', () => {
    render(
      <RayenSyncHistoryModal
        isOpen
        onClose={vi.fn()}
        history={[]}
        recovery={null}
        recoveryBusy={false}
        onRecoveryAction={vi.fn()}
        targetDate="2026-08-01"
      />
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Historial de sincronización · 01-08-2026'
    );
  });
});
