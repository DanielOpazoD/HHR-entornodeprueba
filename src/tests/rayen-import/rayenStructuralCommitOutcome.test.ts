import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  executeRayenStructuralPersistence,
  summarizeRayenStructuralCommit,
} from '@/features/rayen-import/hooks/rayenStructuralCommitOutcome';
import { RayenHistoricalCorrectionAfterCommitError } from '@/features/rayen-import/hooks/confirmRayenImport';

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

const committedResult = (skipped: unknown[] = []) =>
  ({
    appliedDiff: emptyDiff,
    skipped,
    historicalCorrectionsPending: false,
    confirmedHandoff: {},
  }) as never;

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

describe('executeRayenStructuralPersistence', () => {
  it('classifies a complete structural write as applied', async () => {
    const result = committedResult();

    await expect(executeRayenStructuralPersistence(async () => result)).resolves.toMatchObject({
      kind: 'applied',
      result,
      commit: { hasSkippedItems: false },
    });
  });

  it('classifies skipped structural work as applied with omissions', async () => {
    const result = committedResult([{ kind: 'admission', bedId: 'R1', reason: 'occupied' }]);

    await expect(executeRayenStructuralPersistence(async () => result)).resolves.toMatchObject({
      kind: 'applied_with_omissions',
      result,
      commit: { hasSkippedItems: true, skippedItems: 1 },
    });
  });

  it('does not report applicable previous-day work as omitted when confirmation includes it', async () => {
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
    const result = {
      appliedDiff,
      skipped: [],
      historicalCorrectionsPending: false,
      confirmedHandoff: {},
    } as never;

    await expect(
      executeRayenStructuralPersistence(async () => result, { applyPreviousDays: true })
    ).resolves.toMatchObject({
      kind: 'applied',
      commit: { hasSkippedItems: false, skippedItems: 0 },
    });
  });

  it('preserves a committed write that requires a fresh capture', async () => {
    const result = committedResult();
    const error = new RayenHistoricalCorrectionAfterCommitError(result, new Error('conflict'));

    await expect(
      executeRayenStructuralPersistence(async () => {
        throw error;
      })
    ).resolves.toMatchObject({
      kind: 'requires_fresh_capture',
      result,
      error,
      commit: { hasSkippedItems: true, skippedItems: 1 },
    });
  });

  it('returns an uncommitted persistence error as failed', async () => {
    const error = new Error('write failed');

    await expect(
      executeRayenStructuralPersistence(async () => {
        throw error;
      })
    ).resolves.toEqual({ kind: 'failed', error });
  });

  it('keeps a superseded execution silent', async () => {
    await expect(executeRayenStructuralPersistence(async () => null)).resolves.toBeNull();
  });
});
