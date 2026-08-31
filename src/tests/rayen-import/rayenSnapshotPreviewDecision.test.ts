import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  hasNoApplicableRayenStructuralChanges,
  resolveRayenSnapshotPlanningStage,
  shouldOpenRayenSnapshotPreview,
} from '@/features/rayen-import/hooks/rayenSnapshotPlanningDecision';

const createDiff = (conflictCount = 0): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts:
    conflictCount > 0 ? [{ bedId: 'H1C1', reason: 'La ubicación requiere revisión.' }] : [],
  unchangedCount: 1,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: conflictCount,
    unchanged: 1,
  },
});

describe('hasNoApplicableRayenStructuralChanges', () => {
  it('persists a true no-change result without opening a review', () => {
    expect(hasNoApplicableRayenStructuralChanges(createDiff())).toBe(true);
  });

  it('preserves conflict-only no-change persistence while the conflict remains reviewable', () => {
    expect(hasNoApplicableRayenStructuralChanges(createDiff(1))).toBe(true);
    expect(resolveRayenSnapshotPlanningStage(true, true)).toEqual({ type: 'syncing_clinical' });
  });

  it('does not classify pending previous-day corrections as a no-change plan', () => {
    const diff = {
      ...createDiff(),
      previousDayEdits: [
        {
          day: '2026-07-15',
          reason: 'discharge-day-correction',
          patientNames: ['Paciente prueba'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
        },
      ],
    } as CensusImportDiff;

    expect(hasNoApplicableRayenStructuralChanges(diff)).toBe(false);
  });

  it('keeps an unapplied structural conflict cancellable before confirmation', () => {
    expect(resolveRayenSnapshotPlanningStage(false, true)).toEqual({
      type: 'needs_review',
      scope: 'structure',
    });
  });

  it('awaits confirmation for an ordinary structural plan', () => {
    expect(resolveRayenSnapshotPlanningStage(false, false)).toEqual({
      type: 'awaiting_review',
    });
  });

  it('no abre un modal informativo tras persistir: la corrección histórica pendiente vive en el aviso de revisión', () => {
    expect(
      shouldOpenRayenSnapshotPreview({
        persistenceCompleted: true,
        hasUnresolvedConflicts: false,
        hasNoApplicableChanges: true,
      })
    ).toBe(false);
  });

  it('mantiene la revisión de conflictos pendientes tras persistir sin cambios', () => {
    expect(
      shouldOpenRayenSnapshotPreview({
        persistenceCompleted: true,
        hasUnresolvedConflicts: true,
        hasNoApplicableChanges: true,
      })
    ).toBe(true);
  });
});
