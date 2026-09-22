import { fireEvent, render, screen } from '@testing-library/react';
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

it('muestra recuperación histórica aunque el día seleccionado no tenga cambios y conserva aceptación explícita', () => {
  const onConfirm = vi.fn();
  const recoveryOnly: CensusImportDiff = {
    ...pendingOnlyDiff,
    pendingAdministrativeDischarges: [],
    summary: { ...pendingOnlyDiff.summary, pendingAdministrativeDischarges: 0 },
    historicalRecovery: [
      {
        day: '2026-09-19',
        recordExists: false,
        withinEditingWindow: true,
        isSigned: false,
        admissions: [],
        conflicts: [],
        reportEgresos: [
          {
            run: '11111111-1',
            encounterId: '123',
            patientName: 'Paciente ficticio',
            bedLabel: 'H1C1',
            destino: 'Domicilio',
            fechaEgreso: '19-09-2026 15:00',
            kind: 'alta',
            status: 'Vivo',
            correctedDay: '2026-09-19',
            correctedTime: '15:00',
          },
        ],
      },
    ],
  };
  render(
    <RayenImportPreviewModal
      isOpen
      diff={recoveryOnly}
      stage={{ type: 'awaiting_review' }}
      error={null}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  );
  expect(screen.getByText(/Crear censo/)).toBeVisible();
  const checkbox = screen.getByRole('checkbox', { name: /Acepto modificar los días previos/ });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
  expect(onConfirm).toHaveBeenCalledWith(true);
});
