import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PATIENT } from '@/constants/patient';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

describe('RayenImportPreviewModal update presentation', () => {
  it('keeps persistence-only identifiers out of the nurse-facing update list', () => {
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [
        {
          bedId: 'H1C2',
          rut: '14.700.554-4',
          patientName: 'Carina Pate Lillo',
          patient: { ...EMPTY_PATIENT, bedId: 'H1C2' },
          changes: [
            { field: 'treatingPhysicianId', from: undefined, to: '7947' },
            { field: 'treatingPhysicianName', from: undefined, to: 'Angelica Vargas' },
            { field: 'clinicalEpisodeId', from: undefined, to: '142083' },
          ],
        },
        {
          bedId: 'H2C1',
          rut: '5.925.970-9',
          patientName: 'Maria Morales Duarte',
          patient: { ...EMPTY_PATIENT, bedId: 'H2C1' },
          changes: [
            { field: 'pathology', from: 'Diagnóstico anterior', to: 'Diagnóstico actualizado' },
            { field: 'cie10Code', from: undefined, to: 'J80' },
          ],
        },
      ],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 2,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText(/treatingPhysician/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clinicalEpisodeId/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Carina Pate Lillo/)).not.toBeInTheDocument();
    expect(screen.getByText(/Maria Morales Duarte/)).toBeVisible();
    expect(screen.getByText(/diagnóstico, diagnóstico CIE-10/)).toBeVisible();
    expect(screen.getAllByText('Actualizaciones')[0]).toHaveTextContent('1Actualizaciones');
  });
});
