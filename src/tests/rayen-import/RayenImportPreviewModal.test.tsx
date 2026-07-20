import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const diff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [
    {
      bedId: 'H2C1',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'confirmed',
        hospitalDischarge: 'confirmed',
      },
    },
  ],
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
    discharges: 1,
    pendingAdministrativeDischarges: 1,
    conflicts: 0,
    unchanged: 0,
  },
};

describe('RayenImportPreviewModal discharge verification', () => {
  it('shows independent document evidence instead of a single ambiguous closure message', () => {
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

    expect(screen.getAllByTitle('Epicrisis médica: confirmado')).toHaveLength(2);
    expect(screen.getByTitle('Epicrisis enfermería: confirmado')).toBeInTheDocument();
    expect(screen.getByTitle('Egreso hospitalario: confirmado')).toBeInTheDocument();
    expect(screen.getByTitle('Epicrisis enfermería: no detectado')).toBeInTheDocument();
    expect(screen.getByTitle('Egreso hospitalario: no detectado')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Verificación documental del egreso' })).toHaveLength(2);
    expect(screen.getAllByText(': confirmado')).toHaveLength(4);
    expect(
      screen.getByText('cierre clínico registrado; egreso hospitalario aún no detectado')
    ).toBeInTheDocument();
  });
});
