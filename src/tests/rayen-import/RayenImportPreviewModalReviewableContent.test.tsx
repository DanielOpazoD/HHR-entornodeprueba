import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const pendingOnlyDiff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [
    {
      bedId: 'H5C1',
      rut: '29.335.605-K',
      patientName: 'Paciente Pendiente',
      signal: 'clinical-closure',
      encounterId: '141705',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'not-detected',
        hospitalDischarge: 'not-detected',
      },
    },
  ],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 1,
    conflicts: 0,
    unchanged: 0,
  },
};

describe('RayenImportPreviewModal · contenido revisable', () => {
  it('un diff con SOLO egresos administrativos pendientes muestra la revisión, no un modal vacío', () => {
    // Reproducido en vivo (31-08): el planificador abría la revisión por un
    // egreso administrativo pendiente y el modal aparecía vacío con «Listo».
    render(
      <RayenImportPreviewModal
        isOpen
        diff={pendingOnlyDiff}
        stage={{ type: 'awaiting_review' }}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/Paciente Pendiente/)).toBeVisible();
    expect(
      screen.getByText('Pendientes de alta administrativa (se mantienen en cama)')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeVisible();
  });
});
