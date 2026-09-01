import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';

describe('RayenImportPreviewModal previous-day admissions', () => {
  it('explains that a madrugada mother and newborn will also be filed in the prior night shift', () => {
    const diff = {
      admissions: [
        {
          bedId: 'H4C1',
          patient: { ...EMPTY_PATIENT, bedId: 'H4C1', patientName: 'Maeva' },
          isCma: false,
        },
      ],
      updates: [],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia', 'RN de Maeva Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
        },
      ],
      summary: {
        admissions: 1,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    } as CensusImportDiff;

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Ingreso turno noche:')).toBeVisible();
    expect(
      screen.getByText(/Maeva Elisabet Maria Tuki Garcia, RN de Maeva Tuki Garcia/)
    ).toBeVisible();
    expect(screen.getByLabelText('Acepto modificar los días previos indicados')).toBeVisible();
  });

  it('no pide aceptación cuando ninguna edición de día previo escribirá algo', () => {
    // Una edición bloqueada (día firmado) se muestra como información, pero la
    // casilla «Acepto modificar…» sería un consentimiento vacío: no aparece.
    const diff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: true,
        },
      ],
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    } as CensusImportDiff;

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/día ya firmado — se omitirá/)).toBeVisible();
    expect(
      screen.queryByLabelText('Acepto modificar los días previos indicados')
    ).not.toBeInTheDocument();
  });
});
