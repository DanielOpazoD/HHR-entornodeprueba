import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import { RayenImportFlowStatus } from '@/features/rayen-import/components/RayenImportFlowStatus';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';

describe('Rayen synchronization omissions in the pulse bar', () => {
  const settledFill = (
    staffingOutcome: RayenFillProgress['staffingOutcome']
  ): RayenFillProgress => ({
    running: false,
    outcome: 'complete',
    attemptId: 1,
    done: 8,
    total: 8,
    errors: 0,
    lastCompletedAt: '2026-07-21T17:00:00.000Z',
    staffingOutcome,
    staleAtMs: null,
  });

  const renderSettledPulse = (
    staffingOutcome: RayenFillProgress['staffingOutcome'],
    stage: ComponentProps<typeof RayenImportFlowStatus>['executionStage'] = {
      type: 'complete',
    }
  ) =>
    render(
      <RayenImportFlowStatus
        diff={null}
        fill={settledFill(staffingOutcome)}
        error={null}
        hasPersistedSync={false}
        executionStage={stage}
      />
    );

  it('prioritizes a conflict-only review over the background syncing label', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        fill={{ ...settledFill('idle'), outcome: 'idle', done: 0, total: 0, attemptId: 0 }}
        error={null}
        hasPersistedSync={false}
        executionStage={{ type: 'needs_review', scope: 'structure' }}
      />
    );

    expect(screen.getByText('Revisar cambios del censo')).toBeVisible();
  });

  it('does not restore a partial persisted synchronization as fully successful', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        fill={{ ...settledFill('idle'), outcome: 'idle', done: 0, total: 0, attemptId: 0 }}
        error={null}
        hasPersistedSync
        persistedSync={{
          status: 'partial',
          coverage: {
            total: 8,
            completed: 7,
            errors: 1,
            sourceErrors: 1,
            completedAt: '2026-07-21T17:00:00.000Z',
          },
        }}
      />
    );

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Revisar datos de la última sincronización')).toBeVisible();
    expect(screen.getByRole('status')).not.toHaveTextContent('Enfermería/TENS');
  });

  it('does not degrade clinical success when an independent staffing proposal was declined', () => {
    renderSettledPulse('declined');

    expect(screen.getByText('Todo al día')).toBeVisible();
    expect(screen.queryByText(/se mantuvo HHR/)).not.toBeInTheDocument();
  });

  it('keeps skipped work visible after the decision modal closes', () => {
    renderSettledPulse('resolved', { type: 'partial', retry: 'clinical_only' });

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Información clínica pendiente de completar')).toBeVisible();
  });

  it('keeps unresolved conflicts visible after the decision modal closes', () => {
    renderSettledPulse('resolved', { type: 'needs_review', scope: 'structure' });

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Revisar cambios del censo')).toBeVisible();
  });
});

describe('RayenImportPreviewModal · contenido revisable', () => {
  const pendingOnlyDiff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [
      {
        bedId: 'H5C1',
        rut: '10.000.108-K',
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

describe('RayenImportPreviewModal update presentation', () => {
  it('shows an automatically recovered RN instead of reporting zero visible updates', () => {
    const mother = { ...EMPTY_PATIENT, bedId: 'H5C1', patientName: 'Ana Perez' };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [
        {
          bedId: 'H5C1',
          rut: '',
          patientName: 'RN de Ana Perez',
          patient: mother,
          changes: [
            {
              field: 'clinicalCrib',
              from: undefined,
              to: {
                ...EMPTY_PATIENT,
                bedId: 'H5C1',
                patientName: 'RN de Ana Perez',
                clinicalEpisodeId: 'RN',
              },
            },
          ],
        },
      ],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 1,
      summary: {
        admissions: 0,
        updates: 1,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 1,
      },
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
    expect(screen.getByText(/cuna C-H5C1 · RN de Ana Perez/)).toBeVisible();
    expect(screen.getAllByText('Actualizaciones')[0]).toHaveTextContent('1 Actualizaciones');
    expect(screen.queryByText('Confirma la ubicación del RN')).not.toBeInTheDocument();
  });

  it('keeps persistence-only identifiers out of the nurse-facing update list', () => {
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [
        {
          bedId: 'H1C2',
          rut: '14.700.554-4',
          patientName: 'Cogube Paci Lateb',
          patient: { ...EMPTY_PATIENT, bedId: 'H1C2' },
          changes: [
            { field: 'treatingPhysicianId', from: undefined, to: '7947' },
            { field: 'treatingPhysicianName', from: undefined, to: 'Angelica Vargas' },
            { field: 'clinicalEpisodeId', from: undefined, to: '142083' },
          ],
        },
        {
          bedId: 'H2C1',
          rut: '1.000.112-9',
          patientName: 'Mopef Marevev Dinila',
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
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText(/treatingPhysician/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clinicalEpisodeId/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cogube Paci Lateb/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mopef Marevev Dinila/)).toBeVisible();
    expect(screen.getByText(/diagnóstico, diagnóstico CIE-10/)).toBeVisible();
    expect(screen.getAllByText('Actualizaciones')[0]).toHaveTextContent('1 Actualizaciones');
  });
});
