import { describe, expect, it } from 'vitest';
import { areRayenStructuralPlansEquivalent } from '@/features/rayen-import/hooks/confirmRayenImport';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
const structuralDiff = (overrides: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...overrides,
});

describe('reviewed structural plan equivalence', () => {
  it('ignores audit-only unchanged counters while preserving the reviewed operations', () => {
    expect(
      areRayenStructuralPlansEquivalent(
        structuralDiff({ unchangedCount: 1 }),
        structuralDiff({ unchangedCount: 9 })
      )
    ).toBe(true);
  });

  it('detects a newly introduced admission before a CAS retry', () => {
    expect(
      areRayenStructuralPlansEquivalent(
        structuralDiff(),
        structuralDiff({
          admissions: [
            {
              bedId: 'H1C1',
              patient: { patientName: 'Paciente nuevo' } as never,
              isCma: false,
            },
          ],
        })
      )
    ).toBe(false);
  });
});
