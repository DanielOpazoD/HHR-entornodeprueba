import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

describe('already filed historical discharge preview', () => {
  it.each([false, true])(
    'explains removal without promising another discharge (historical repair %s)',
    repair => {
      const diff: CensusImportDiff = {
        admissions: [],
        updates: [],
        moves: [],
        conflicts: [],
        pendingAdministrativeDischarges: [],
        unchangedCount: 0,
        discharges: [
          {
            bedId: 'R3',
            rut: 'synthetic',
            patientName: 'Paciente de prueba',
            kind: 'alta',
            status: 'Vivo',
            reason: 'administrative-discharge',
            correctedDay: '2026-09-26',
            historicalMovementRecorded: true,
          },
        ],
        summary: {
          admissions: 0,
          updates: 0,
          moves: 0,
          discharges: 1,
          conflicts: 0,
          pendingAdministrativeDischarges: 0,
          unchanged: 0,
        },
        previousDayEdits: repair
          ? [
              {
                day: '2026-09-26',
                reason: 'discharge-day-correction',
                patientNames: ['Paciente de prueba'],
                recordExists: true,
                withinEditingWindow: true,
                isSigned: false,
              },
            ]
          : [],
      };
      render(
        <RayenImportPreviewModal
          isOpen
          diff={diff}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/ya registrado el 26-09-2026; se retirará la copia/)).toBeVisible();
      expect(screen.queryByText(/se grabará el/)).not.toBeInTheDocument();
    }
  );
});
