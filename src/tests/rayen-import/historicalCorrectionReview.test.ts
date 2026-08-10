import { describe, expect, it } from 'vitest';
import { hasSkippedPreviousDayCorrections } from '@/features/rayen-import/hooks/confirmRayenImport';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

const diffWithPreviousDay = (
  overrides: Partial<NonNullable<CensusImportDiff['previousDayEdits']>[number]> = {}
) =>
  ({
    previousDayEdits: [
      {
        day: '2026-07-15',
        reason: 'discharge-day-correction',
        patientNames: ['Paciente prueba'],
        recordExists: true,
        withinEditingWindow: true,
        isSigned: false,
        ...overrides,
      },
    ],
  }) as CensusImportDiff;

describe('hasSkippedPreviousDayCorrections', () => {
  it('reports an explicitly unchecked historical correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay(), false)).toBe(true);
  });

  it('reports an unwritable historical correction as skipped', () => {
    expect(
      hasSkippedPreviousDayCorrections(diffWithPreviousDay({ withinEditingWindow: false }), true)
    ).toBe(true);
  });

  it('reports a signed historical correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay({ isSigned: true }), true)).toBe(
      true
    );
  });

  it('does not report an accepted writable correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay(), true)).toBe(false);
  });
});
