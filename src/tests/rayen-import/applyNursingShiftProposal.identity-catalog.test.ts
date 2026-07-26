import { describe, expect, it } from 'vitest';
import {
  buildNursingShiftProposalPatch,
  reconcileNursingShiftProposal,
} from '@/features/rayen-import/domain/applyNursingShiftProposal';
import type { NursingStaffingProposal } from '@/features/rayen-import/contracts/nursingShiftInference';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const suggestion = (names: string[], catalogNames: string[] = names) => ({
  names,
  catalogNames,
  candidates: names.map((name, index) => ({
    name,
    observedNames: [name],
    records: 2,
    patients: 2,
    activeHours: 2,
    score: 16 - index,
    hasShiftChange: false,
    catalogMatched: true,
  })),
  ignoredBoundaryRecords: 0,
  ambiguous: false,
});

const withIdentityAliases = (
  value: ReturnType<typeof suggestion>,
  aliases: Record<string, string[]>
): ReturnType<typeof suggestion> => ({
  ...value,
  candidates: value.candidates.map(candidate => ({
    ...candidate,
    identityAliases: aliases[candidate.name] ?? [],
  })),
});

const proposal: NursingStaffingProposal = {
  censusDate: '2026-07-20',
  day: suggestion([]),
  night: suggestion([]),
};

const record = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-07-20',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    lastUpdated: '',
    ...overrides,
  }) as DailyRecord;

describe('nursing shift catalog identity reconciliation', () => {
  it('does not replace a complete roster when Eloisa only adds second surnames', () => {
    const current = record({ nursesNightShift: ['Camila Soto', 'Pedro Moreno'] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      night: withIdentityAliases(suggestion(['Camila Soto Alegría', 'Pedro Moreno Opazo']), {
        'Camila Soto Alegría': ['Camila Soto'],
        'Pedro Moreno Opazo': ['Pedro Moreno'],
      }),
    });

    expect(review.night.names).toEqual([]);
    expect(review.night.alreadyAssigned).toEqual(['Camila Soto Alegría', 'Pedro Moreno Opazo']);
    expect(review.night.replaceStandardSlots).toBe(false);
    expect(review.night.currentNames).toBeUndefined();
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('keeps distinct exact candidates even when their names share tokens', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    });

    expect(review.day.names).toEqual(['Ana Pérez', 'Ana Pérez Soto']);
    expect(review.day.candidates).toHaveLength(3);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez',
      'Ana Pérez Soto',
    ]);
  });

  it('does not treat a candidate self-observation as an ambiguous second identity', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', ''] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez', 'Ana Pérez Soto']),
    });

    expect(review.day.ambiguous).toBe(false);
    expect(review.day.alreadyAssigned).toEqual(['Ana Pérez']);
    expect(review.day.names).toEqual(['Ana Pérez Soto']);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez',
      'Ana Pérez Soto',
    ]);
  });

  it('removes a non-catalog short alias when every known full identity is selected', () => {
    const current = record();
    const inferred = withIdentityAliases(
      suggestion(['Ana Pérez Soto', 'Ana Pérez Rojas'], ['Ana Pérez Soto', 'Ana Pérez Rojas']),
      {
        'Ana Pérez Soto': ['Ana Pérez'],
        'Ana Pérez Rojas': ['Ana Pérez'],
      }
    );
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: { ...inferred, names: ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas'] },
    });

    expect(review.day.names).toEqual(['Ana Pérez Soto', 'Ana Pérez Rojas']);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez Soto',
      'Ana Pérez Rojas',
    ]);
  });

  it('does not merge full identities that share the same observed short alias', () => {
    const current = record();
    const inferred = suggestion(['Ana Pérez Soto', 'Ana Pérez Rojas']);
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: {
        ...inferred,
        candidates: inferred.candidates.map(candidate => ({
          ...candidate,
          observedNames: ['Ana Pérez'],
        })),
      },
    });

    expect(review.day.names).toEqual(['Ana Pérez Soto', 'Ana Pérez Rojas']);
  });

  it('does not reinterpret an exact short candidate from catalog shape alone', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez'], ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    });

    expect(review.day.names).toEqual(['Ana Pérez']);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez',
      '',
    ]);
  });

  it('quarantines a full proposal when an occupied short alias is ambiguous', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', ''] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: withIdentityAliases(
        suggestion(['Ana Pérez Soto'], ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
        { 'Ana Pérez Soto': ['Ana Pérez'] }
      ),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('uses other occupied full names when deciding whether a short alias is ambiguous', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', 'Ana Pérez Rojas'] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: withIdentityAliases(suggestion(['Ana Pérez Soto'], ['Ana Pérez Soto']), {
        'Ana Pérez Soto': ['Ana Pérez'],
      }),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('keeps selected exact candidates distinct from unselected catalog names', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(
        ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas'],
        ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas', 'Ana Pérez Díaz']
      ),
    });

    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez',
      'Ana Pérez Soto',
    ]);
  });

  it('never duplicates an exact occupied short label from an unreconciled proposal', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', ''] });
    const rawProposal: NursingStaffingProposal = {
      ...proposal,
      day: suggestion(['Ana Pérez'], ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    };

    expect(buildNursingShiftProposalPatch(current, rawProposal)).toBeNull();
  });

  it('does not replace an occupied short alias when multiple full identities are known', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', 'Manual'] });
    const rawReplacement: NursingStaffingProposal = {
      ...proposal,
      day: {
        ...withIdentityAliases(
          suggestion(
            ['Ana Pérez Soto', 'Nueva Enfermera'],
            ['Ana Pérez Soto', 'Ana Pérez Rojas', 'Nueva Enfermera']
          ),
          { 'Ana Pérez Soto': ['Ana Pérez'] }
        ),
        currentNames: ['Ana Pérez', 'Manual'],
        replaceStandardSlots: true,
      },
    };

    expect(buildNursingShiftProposalPatch(current, rawReplacement)).toBeNull();
  });
});
