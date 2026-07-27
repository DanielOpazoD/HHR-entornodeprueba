import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

describe('RayenSyncHistoryModal staffing observations', () => {
  it('explains why Enfermería/TENS was not modified', () => {
    render(
      <RayenSyncHistoryModal
        isOpen
        onClose={vi.fn()}
        recovery={null}
        recoveryBusy={false}
        onRecoveryAction={vi.fn()}
        history={[
          {
            id: 'run-1',
            startedAt: '2026-07-26T10:52:00.000Z',
            completedAt: '2026-07-26T10:54:00.000Z',
            by: 'Enfermera prueba',
            status: 'complete',
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 12 },
            coverage: {
              total: 12,
              completed: 12,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-07-26T10:54:00.000Z',
            },
            staffingObservation: {
              ambiguousSections: ['nurse_night'],
              ignoredBoundaryRecords: 2,
            },
          },
        ]}
      />
    );

    expect(screen.getByText('Enfermería / TENS: por qué quedó con observación')).toBeVisible();
    expect(screen.getByText(/Enfermería · turno noche/)).toBeVisible();
    expect(screen.getByText(/Se excluyeron 2 registros cercanos al relevo/)).toBeVisible();
    expect(screen.getByText(/HHR no modificó la dotación/)).toBeVisible();
  });
});
