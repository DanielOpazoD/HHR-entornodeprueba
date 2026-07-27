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
              ignoredBoundaryEvidence: [
                {
                  section: 'tens_night',
                  name: 'Jimena Yáñez',
                  role: 'Paramédico',
                  recordedAt: '2026-07-26T20:35:00',
                  source: 'medication-administration',
                  boundary: 'night_start',
                },
                {
                  section: 'nurse_night',
                  name: 'Camila Soto',
                  role: 'Enfermera(o)',
                  recordedAt: '2026-07-26T20:48:00',
                  source: 'vital-signs',
                  boundary: 'night_start',
                },
              ],
            },
          },
        ]}
      />
    );

    expect(screen.getByText('Enfermería / TENS: por qué quedó con observación')).toBeVisible();
    expect(screen.getByText(/Enfermería · turno noche/)).toBeVisible();
    expect(screen.getByText(/Se excluyeron 2 registros cercanos al relevo/)).toBeVisible();
    expect(screen.getByText(/HHR no modificó la dotación/)).toBeVisible();
    expect(screen.getByText('Ver quiénes fueron excluidos (2)')).toBeVisible();
    expect(screen.getByText(/Jimena Yáñez · 26-07 20:35/)).toBeInTheDocument();
    expect(screen.getByText(/TENS · noche · Paramédico · Medicamento/)).toBeInTheDocument();
    expect(screen.getByText('Duración 2 min')).toBeVisible();
  });
});
