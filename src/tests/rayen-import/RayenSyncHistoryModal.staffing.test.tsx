import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

describe('RayenSyncHistoryModal staffing observations', () => {
  it('keeps staffing details collapsed without explanatory paragraphs or nested disclosures', () => {
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

    const detail = screen.getByTestId('rayen-staffing-observation');
    expect(screen.getByText('Requiere revisión')).toBeVisible();
    expect(detail).not.toHaveAttribute('open');
    expect(screen.getByText(/Enfermería · turno noche/)).not.toBeVisible();
    expect(screen.queryByText(/HHR detectó|HHR no modificó la dotación/)).not.toBeInTheDocument();
    expect(detail.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByText(/Ver detalle · 2 registros/));
    expect(detail).toHaveAttribute('open');
    expect(screen.getByText(/Enfermería · turno noche/)).toBeVisible();
    expect(screen.getByText(/Jimena Yáñez · 26-07 20:35/)).toBeVisible();
    expect(screen.getByText(/TENS · noche · Paramédico · Medicamento/)).toBeVisible();
    expect(screen.getByText('Duración 2 min')).toBeVisible();
    expect(screen.getByText(/Cobertura clínica: 12\/12 completa/)).toBeVisible();
    fireEvent.click(screen.getByText('Requiere revisión'));
    expect(detail).not.toHaveAttribute('open');
  });

  it('shows repeated or capped evidence as unique rows without misclassifying the hidden detail', () => {
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

    expect(screen.getByText('Actividad de relevo')).toBeVisible();
    expect(screen.getByTestId('rayen-staffing-observation')).not.toHaveAttribute('open');
    expect(screen.getByTestId('rayen-staffing-observation')).not.toHaveClass('border-amber-200');

    fireEvent.click(screen.getByText(/Ver detalle · 3 registros/));
    expect(screen.getAllByText(/Camila Soto · 26-07 20:48/)).toHaveLength(1);
    expect(
      screen.getByText(
        /1 firmas únicas disponibles.*acciones repetidas o detalles omitidos por el límite del historial/
      )
    ).toBeVisible();
  });
});
