import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

describe('RayenSyncHistoryModal staffing observations', () => {
  it('keeps staffing activity out of census history while retaining clinical coverage', () => {
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

    expect(screen.queryByTestId('rayen-staffing-observation')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Enfermería y TENS' })).not.toBeInTheDocument();
    expect(screen.getByText('Duración 2 min')).toBeVisible();
    expect(screen.getByText(/Cobertura clínica: 12\/12 completa/)).toBeVisible();
  });

  it('does not render staffing evidence in the census history', () => {
    const repeatedEvidence = {
      section: 'nurse_night' as const,
      name: 'Camila Soto',
      role: 'Enfermera(o)',
      recordedAt: '2026-07-26T20:48:00',
      source: 'vital-signs' as const,
      boundary: 'night_start' as const,
    };
    render(
      <RayenSyncHistoryModal
        isOpen
        onClose={vi.fn()}
        recovery={null}
        recoveryBusy={false}
        onRecoveryAction={vi.fn()}
        history={[
          {
            id: 'run-repeated-evidence',
            startedAt: '2026-07-26T10:52:00.000Z',
            completedAt: '2026-07-26T10:54:00.000Z',
            by: 'Enfermera prueba',
            status: 'complete',
            staffingObservation: {
              ambiguousSections: [],
              ignoredBoundaryRecords: 3,
              ignoredBoundaryEvidence: [repeatedEvidence, repeatedEvidence],
            },
          },
        ]}
      />
    );

    expect(screen.queryByText('Actividad de relevo')).not.toBeInTheDocument();
    expect(screen.queryByText(/Camila Soto/)).not.toBeInTheDocument();
  });
});
