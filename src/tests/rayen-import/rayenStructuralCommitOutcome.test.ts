import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { summarizeRayenStructuralCommit } from '@/features/rayen-import/hooks/rayenStructuralCommitOutcome';

const emptyDiff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 1,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 1,
  },
};

describe('summarizeRayenStructuralCommit', () => {
  it('keeps unapplied previous-day edits visible as skipped work', () => {
    const appliedDiff = {
      ...emptyDiff,
      previousDayEdits: [
        {
          day: '2026-07-27',
          reason: 'discharge-day-correction',
          patientNames: ['Paciente prueba'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
        },
      ],
    } as CensusImportDiff;

    const summary = summarizeRayenStructuralCommit(
      {
        appliedDiff,
        skipped: [],
        historicalCorrectionsPending: false,
        confirmedHandoff: {} as never,
      } as never,
      false
    );

    expect(summary.skippedItems).toBe(1);
    expect(summary.hasSkippedItems).toBe(true);
  });

  it('counts overlapping historical follow-up signals only once', () => {
    const appliedDiff = {
      ...emptyDiff,
      previousDayEdits: [
        {
          day: '2026-07-27',
          reason: 'discharge-day-correction',
          patientNames: ['Paciente prueba'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
        },
      ],
    } as CensusImportDiff;

    const summary = summarizeRayenStructuralCommit(
      {
        appliedDiff,
        skipped: [],
        historicalCorrectionsPending: true,
        confirmedHandoff: {} as never,
      } as never,
      true
    );

    expect(summary.skippedItems).toBe(1);
    expect(summary.hasSkippedItems).toBe(true);
  });
});
