import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RayenImportFlowStatus } from '@/features/rayen-import/components/RayenImportFlowStatus';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { RayenNursingShiftProposalModal } from '@/features/rayen-import/components/RayenNursingShiftProposalModal';
import type { CensusImportDiff } from '@/features/rayen-import';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';
import { EMPTY_PATIENT } from '@/constants/patient';

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

const fill = (overrides: Partial<RayenFillProgress> = {}): RayenFillProgress => ({
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
  ...overrides,
});

const renderPulse = (
  progress: RayenFillProgress,
  overrides: Partial<ComponentProps<typeof RayenImportFlowStatus>> = {}
) =>
  render(
    <RayenImportFlowStatus
      diff={diff}
      fill={progress}
      isApplyingCensus={false}
      isPreviewOpen={false}
      isSyncing={false}
      error={null}
      hasPersistedSync={false}
      {...overrides}
    />
  );

describe('Rayen synchronization decisions and pulse', () => {
  it('makes a newborn included in the mother admission explicit in the preview', () => {
    const motherAndNewbornDiff: CensusImportDiff = {
      ...diff,
      admissions: [
        {
          bedId: 'H4C1',
          isCma: false,
          patient: {
            ...EMPTY_PATIENT,
            bedId: 'H4C1',
            patientName: 'Maeva Elisabet Maria Tuki Garcia',
            rut: '17.059.646-3',
            clinicalCrib: {
              ...EMPTY_PATIENT,
              bedId: 'H4C1',
              bedMode: 'Cuna',
              patientName: 'RN de Maeva Tuki Garcia',
              clinicalEpisodeId: '143101',
            },
          },
        },
      ],
      discharges: [],
      pendingAdministrativeDischarges: [],
      summary: {
        ...diff.summary,
        admissions: 1,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
      },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={motherAndNewbornDiff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'DIV' &&
          element.textContent === 'H4C1 — Maeva Elisabet Maria Tuki Garcia'
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'DIV' &&
          element.textContent === '↳ Cuna clínica — RN de Maeva Tuki Garcia'
      )
    ).toBeVisible();
  });

  it('shows independent document evidence in the review decision', () => {
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
    expect(
      screen.getAllByRole('group', { name: 'Verificación documental del egreso' })
    ).toHaveLength(2);
  });

  it('keeps live clinical progress and all modules in the bar', () => {
    renderPulse(fill({ running: true, outcome: 'running', attemptId: 1, done: 2, total: 4 }));

    expect(
      screen.getByRole('progressbar', { name: 'Progreso de sincronización con Eloísa' })
    ).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByText('Censo')).toBeInTheDocument();
    expect(screen.getByText('Signos vitales')).toBeInTheDocument();
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Scores')).toBeInTheDocument();
    expect(screen.getByText('Enfermería / TENS')).toBeInTheDocument();
    expect(screen.getByText('Revisando información clínica · 68%')).toBeVisible();
  });

  it('makes a pending census review explicit without claiming progress is complete', () => {
    renderPulse(fill(), { isPreviewOpen: true });

    expect(screen.getByText('1 cambio listo para revisar')).toBeVisible();
    expect(screen.getByTitle('Censo: 1 cambio por revisar')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('settles quietly at 100% after a complete run', () => {
    renderPulse(
      fill({
        outcome: 'complete',
        attemptId: 1,
        done: 8,
        total: 8,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'resolved',
      })
    );

    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(screen.getByRole('status')).toHaveTextContent('Todo al día');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByTitle('Censo: Verificado')).toBeInTheDocument();
    expect(screen.getByTitle('Signos vitales: Verificado')).toBeInTheDocument();
    expect(screen.getByTitle('Dispositivos: Verificado')).toBeInTheDocument();
    expect(screen.getByTitle('Scores: Verificado')).toBeInTheDocument();
  });

  it('keeps a partial clinical result visible as an observation', () => {
    renderPulse(
      fill({
        outcome: 'partial',
        attemptId: 1,
        done: 8,
        total: 8,
        errors: 1,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'resolved',
      })
    );

    expect(screen.getByText('Sincronización completada con observaciones')).toBeVisible();
    expect(screen.getByTitle('Signos vitales: 1 con observación')).toBeInTheDocument();
    expect(screen.getByTitle('Dispositivos: 1 con observación')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('describes a global partial result without a misleading zero count', () => {
    renderPulse(
      fill({
        outcome: 'partial',
        attemptId: 1,
        done: 8,
        total: 8,
        errors: 0,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'resolved',
      })
    );

    expect(screen.getByTitle('Signos vitales: Con observaciones')).toBeInTheDocument();
    expect(screen.queryByText('0 con observación')).not.toBeInTheDocument();
  });

  it('turns staffing evidence into one clear decision', () => {
    renderPulse(
      fill({
        outcome: 'complete',
        attemptId: 1,
        done: 8,
        total: 8,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'pending',
      })
    );

    expect(screen.getByText('Revisión lista · 1 decisión pendiente')).toBeVisible();
    expect(screen.getByTitle('Enfermería / TENS: Requiere revisión')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows staffing application without reopening the general review modal', () => {
    renderPulse(
      fill({
        outcome: 'complete',
        attemptId: 1,
        done: 8,
        total: 8,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'applying',
      })
    );

    expect(screen.getByText('Aplicando propuesta de enfermería')).toBeVisible();
    expect(screen.getByTitle('Enfermería / TENS: Aplicando')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '98');
  });

  it('does not inherit success when a single-flight attempt is rejected', () => {
    renderPulse(
      fill({
        running: true,
        outcome: 'rejected',
        attemptId: 2,
        done: 3,
        total: 8,
        lastCompletedAt: '2026-07-20T17:00:00.000Z',
      }),
      { isSyncing: true }
    );

    expect(screen.getByText('La información clínica no pudo iniciar')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
  });

  it('uses the general modal only for the import accept or reject decision', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps unresolved conflict details visible after the other changes are applied', () => {
    const conflictDiff: CensusImportDiff = {
      ...diff,
      conflicts: [
        {
          bedId: 'H2C1',
          rut: '22.025.389-9',
          patientName: 'Paciente en conflicto',
          reason: 'La cama tiene dos identidades diferentes.',
        },
      ],
      summary: { ...diff.summary, conflicts: 1 },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={conflictDiff}
        isBusy={false}
        error={null}
        isApplied
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Conflictos pendientes')).toBeVisible();
    expect(screen.getByText('H2C1: La cama tiene dos identidades diferentes.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmar e importar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible();
  });

  it('shows a conflict-only review without offering an empty import', () => {
    const conflictOnlyDiff: CensusImportDiff = {
      ...diff,
      admissions: [],
      updates: [],
      moves: [],
      discharges: [],
      reportEgresos: [],
      conflicts: [
        {
          bedId: 'H5C1',
          reason: 'La identidad de la cuna clínica requiere revisión manual.',
        },
      ],
      summary: {
        ...diff.summary,
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        conflicts: 1,
      },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={conflictOnlyDiff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText('H5C1: La identidad de la cuna clínica requiere revisión manual.')
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmar e importar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible();
  });

  it('presents unresolved D-1 traceability as a compact non-destructive review', () => {
    const historicalDiff: CensusImportDiff = {
      ...diff,
      admissions: [],
      updates: [],
      moves: [],
      discharges: [],
      reportEgresos: [],
      conflicts: [
        {
          bedId: null,
          rut: '11.111.111-1',
          patientName: 'Paciente Histórico',
          code: 'historical-reconstruction',
          reason: 'No se confirmó una cama antes del cierre.',
        },
      ],
      summary: {
        ...diff.summary,
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        conflicts: 1,
      },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={historicalDiff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('1 paciente quedó sin cambios')).toBeVisible();
    expect(screen.getByText('Ver pacientes que requieren revisión')).toBeVisible();
    expect(screen.queryByText('Conflictos (no se aplican)')).not.toBeInTheDocument();
  });

  it('presents nursing as an independent modal with symmetric choices', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <RayenNursingShiftProposalModal
        proposal={{
          censusDate: '2026-07-21',
          day: {
            names: ['Camila Leiva'],
            candidates: [],
            ignoredBoundaryRecords: 0,
            ambiguous: false,
          },
          night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
        }}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Dotación clínica identificada' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mantener actual' }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar propuesta' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
