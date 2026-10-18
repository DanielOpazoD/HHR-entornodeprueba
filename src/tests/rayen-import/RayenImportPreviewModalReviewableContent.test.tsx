import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { EMPTY_PATIENT } from '@/constants/patient';
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
  it('shows unresolved reasons read-only after the clinical stage settles', () => {
    const diff = {
      ...pendingOnlyDiff,
      pendingAdministrativeDischarges: [],
      conflicts: [{ bedId: 'R1', reason: 'Falta el episodio exacto.' }],
      summary: { ...pendingOnlyDiff.summary, pendingAdministrativeDischarges: 0, conflicts: 1 },
    };
    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        stage={{ type: 'needs_review', scope: 'post_commit' }}
        isApplied
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('R1: Falta el episodio exacto.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmar e importar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible();
  });

  it('identifies the patient when only internal episode metadata changes, before confirmation', () => {
    const onConfirm = vi.fn();
    const diff: CensusImportDiff = {
      ...pendingOnlyDiff,
      pendingAdministrativeDischarges: [],
      updates: [
        {
          bedId: 'R1',
          rut: 'synthetic-document',
          patientName: 'Paciente sintético',
          patient: { ...EMPTY_PATIENT, bedId: 'R1', patientName: 'Paciente sintético' },
          changes: [{ field: 'treatingPhysicianId', from: '', to: 'synthetic-physician' }],
        },
      ],
      summary: { ...pendingOnlyDiff.summary, updates: 1, pendingAdministrativeDischarges: 0 },
    };
    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        stage={{ type: 'awaiting_review' }}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Paciente sintético:', { exact: false })).toBeVisible();
    expect(screen.getByText('datos del episodio')).toBeVisible();
    expect(screen.getAllByText('Actualizaciones').length).toBeGreaterThan(0);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

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
