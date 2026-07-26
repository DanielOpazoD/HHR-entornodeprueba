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

describe('nursing shift identity reconciliation', () => {
  it('keeps short and full names separate when both are exact catalog identities', () => {
    const current = record();
    const rawProposal: NursingStaffingProposal = {
      ...proposal,
      day: suggestion(['Pedro Moreno', 'Pedro Moreno Opazo']),
    };
    const review = reconcileNursingShiftProposal(current, rawProposal);

    expect(review.day.names).toEqual(['Pedro Moreno', 'Pedro Moreno Opazo']);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Pedro Moreno',
      'Pedro Moreno Opazo',
    ]);
    expect(buildNursingShiftProposalPatch(current, rawProposal)?.nursesDayShift).toEqual([
      'Pedro Moreno',
      'Pedro Moreno Opazo',
    ]);
  });

  it('keeps the existing short name when Eloisa proposes its longer variant', () => {
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Pedro Moreno', ''] }), {
      ...proposal,
      day: suggestion(['Pedro Moreno Opazo'], ['Pedro Moreno Opazo']),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.alreadyAssigned).toEqual(['Pedro Moreno Opazo']);
  });

  it('does not count observed spellings of one candidate as different people', () => {
    const inferred = suggestion(['Camila Soto Alegría'], ['Camila Soto Alegría']);
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Camila Soto', ''] }), {
      ...proposal,
      day: {
        ...inferred,
        candidates: [
          {
            ...inferred.candidates[0],
            observedNames: ['Camila Soto Alegría', 'Camila Soto A'],
          },
        ],
      },
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.alreadyAssigned).toEqual(['Camila Soto Alegría']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('reduces a uniquely resolvable short and full proposal to one person', () => {
    const current = record();
    const rawProposal: NursingStaffingProposal = {
      ...proposal,
      day: suggestion(['Camila Soto', 'Camila Soto Alegría'], ['Camila Soto Alegría']),
    };
    const review = reconcileNursingShiftProposal(current, rawProposal);

    expect(review.day.names).toEqual(['Camila Soto Alegría']);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Camila Soto Alegría',
      '',
    ]);
  });

  it('preserves the first spelling when exact normalized identities repeat', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['José Pérez', 'JOSE PEREZ']),
    });

    expect(review.day.names).toEqual(['José Pérez']);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'José Pérez',
      '',
    ]);
  });

  it('does not treat a distinct exact catalog identity as already synchronized', () => {
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Pedro Moreno', ''] }), {
      ...proposal,
      day: suggestion(['Pedro Moreno Opazo'], ['Pedro Moreno', 'Pedro Moreno Opazo']),
    });

    expect(review.day.names).toEqual(['Pedro Moreno Opazo']);
    expect(review.day.alreadyAssigned).toEqual([]);
  });

  it('does not replace a complete roster when Eloisa only adds second surnames', () => {
    const current = record({ nursesNightShift: ['Camila Soto', 'Pedro Moreno'] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      night: suggestion(['Camila Soto Alegría', 'Pedro Moreno Opazo']),
    });

    expect(review.night.names).toEqual([]);
    expect(review.night.alreadyAssigned).toEqual(['Camila Soto Alegría', 'Pedro Moreno Opazo']);
    expect(review.night.replaceStandardSlots).toBe(false);
    expect(review.night.currentNames).toBeUndefined();
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('does not let one ambiguous short name merge two distinct full identities', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    });

    expect(review.day.names).toEqual(['Ana Pérez', 'Ana Pérez Soto']);
    expect(review.day.candidates).toHaveLength(3);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('removes a non-catalog short alias when every known full identity is selected', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(
        ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas'],
        ['Ana Pérez Soto', 'Ana Pérez Rojas']
      ),
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

  it('quarantines a short candidate when the catalog contains multiple full variants', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez'], ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    });

    expect(review.day.names).toEqual(['Ana Pérez']);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('quarantines a full proposal when an occupied short alias is ambiguous', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', ''] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez Soto'], ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('uses other occupied full names when deciding whether a short alias is ambiguous', () => {
    const current = record({ nursesDayShift: ['Ana Pérez', 'Ana Pérez Rojas'] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Ana Pérez Soto'], ['Ana Pérez Soto']),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('keeps a short alias ambiguous until every known full variant is selected', () => {
    const current = record();
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(
        ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas'],
        ['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas', 'Ana Pérez Díaz']
      ),
    });

    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
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
        ...suggestion(
          ['Ana Pérez Soto', 'Nueva Enfermera'],
          ['Ana Pérez Soto', 'Ana Pérez Rojas', 'Nueva Enfermera']
        ),
        currentNames: ['Ana Pérez', 'Manual'],
        replaceStandardSlots: true,
      },
    };

    expect(buildNursingShiftProposalPatch(current, rawReplacement)).toBeNull();
  });
});
