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
      day: withIdentityAliases(suggestion(['Pedro Moreno Opazo'], ['Pedro Moreno Opazo']), {
        'Pedro Moreno Opazo': ['Pedro Moreno'],
      }),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.alreadyAssigned).toEqual(['Pedro Moreno Opazo']);
  });

  it('does not count observed spellings of one candidate as different people', () => {
    const inferred = withIdentityAliases(
      suggestion(['Camila Soto Alegría'], ['Camila Soto Alegría']),
      { 'Camila Soto Alegría': ['Camila Soto'] }
    );
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

  it('uses explicit observed evidence even when both labels exist in the catalog', () => {
    const inferred = suggestion(['Camila Soto Alegría'], ['Camila Soto', 'Camila Soto Alegría']);
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Camila Soto', ''] }), {
      ...proposal,
      day: {
        ...inferred,
        candidates: [{ ...inferred.candidates[0], observedNames: ['Camila Soto'] }],
      },
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.alreadyAssigned).toEqual(['Camila Soto Alegría']);
  });

  it('deduplicates a catalog-listed alias backed by one canonical candidate', () => {
    const inferred = suggestion(['Camila Soto Alegría'], ['Camila Soto', 'Camila Soto Alegría']);
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: {
        ...inferred,
        names: ['Camila Soto', 'Camila Soto Alegría'],
        candidates: [{ ...inferred.candidates[0], observedNames: ['Camila Soto'] }],
      },
    });

    expect(review.day.names).toEqual(['Camila Soto Alegría']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('scopes each structured alias to its own canonical candidate', () => {
    const inferred = withIdentityAliases(
      suggestion(
        ['Camila Soto Alegría', 'Pedro Moreno Opazo'],
        ['Camila Soto Alegría', 'Pedro Moreno Opazo']
      ),
      {
        'Camila Soto Alegría': ['Camila Soto'],
        'Pedro Moreno Opazo': ['Pedro Moreno'],
      }
    );
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Camila Soto', ''] }), {
      ...proposal,
      day: inferred,
    });

    expect(review.day.alreadyAssigned).toEqual(['Camila Soto Alegría']);
    expect(review.day.names).toEqual(['Pedro Moreno Opazo']);
  });

  it('quarantines a compound-name alias shared by multiple candidates', () => {
    const inferred = withIdentityAliases(
      suggestion(['Juan Pablo Pérez Soto', 'Juan Carlos Pérez Rojas']),
      {
        'Juan Pablo Pérez Soto': ['Juan Pérez'],
        'Juan Carlos Pérez Rojas': ['Juan Pérez'],
      }
    );
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Juan Pérez', ''] }), {
      ...proposal,
      day: inferred,
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
  });

  it('includes catalog-only compound identities when checking an occupied alias', () => {
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Juan Pérez', ''] }), {
      ...proposal,
      day: withIdentityAliases(
        suggestion(['Juan Pablo Pérez Soto'], ['Juan Pablo Pérez Soto', 'Juan Carlos Pérez Rojas']),
        { 'Juan Pablo Pérez Soto': ['Juan Pérez'] }
      ),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
  });

  it('reduces a uniquely resolvable short and full proposal to one person', () => {
    const current = record();
    const inferred = withIdentityAliases(
      suggestion(['Camila Soto Alegría'], ['Camila Soto Alegría']),
      { 'Camila Soto Alegría': ['Camila Soto'] }
    );
    const rawProposal: NursingStaffingProposal = {
      ...proposal,
      day: { ...inferred, names: ['Camila Soto', 'Camila Soto Alegría'] },
    };
    const review = reconcileNursingShiftProposal(current, rawProposal);

    expect(review.day.names).toEqual(['Camila Soto Alegría']);
    expect(review.day.ambiguous).toBe(false);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Camila Soto Alegría',
      '',
    ]);
  });

  it('deduplicates a compound full name through its authoritative surname alias', () => {
    const current = record();
    const inferred = withIdentityAliases(
      suggestion(['Juan Pablo Pérez Soto'], ['Juan Pablo Pérez Soto']),
      { 'Juan Pablo Pérez Soto': ['Juan Pérez'] }
    );
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: { ...inferred, names: ['Juan Pérez', 'Juan Pablo Pérez Soto'] },
    });

    expect(review.day.names).toEqual(['Juan Pablo Pérez Soto']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('deduplicates authoritative aliases with a compound surname', () => {
    const inferred = withIdentityAliases(
      suggestion(['Ana de la Fuente Soto'], ['Ana de la Fuente Soto']),
      { 'Ana de la Fuente Soto': ['Ana de la Fuente'] }
    );
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: { ...inferred, names: ['Ana de la Fuente', 'Ana de la Fuente Soto'] },
    });

    expect(review.day.names).toEqual(['Ana de la Fuente Soto']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('does not collapse a short alias while a catalog alternative remains unselected', () => {
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: withIdentityAliases(
        suggestion(['Ana Pérez', 'Ana Pérez Soto'], ['Ana Pérez Soto', 'Ana Pérez Rojas']),
        { 'Ana Pérez Soto': ['Ana Pérez'] }
      ),
    });

    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(record(), review)).toBeNull();
  });

  it('does not collapse a short name that is also a canonical candidate', () => {
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: withIdentityAliases(suggestion(['Ana Pérez', 'Ana Pérez Soto'], ['Ana Pérez Soto']), {
        'Ana Pérez Soto': ['Ana Pérez'],
      }),
    });

    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(record(), review)).toBeNull();
  });

  it('quarantines an occupied exact candidate that is also another candidate alias', () => {
    const inferred = withIdentityAliases(
      suggestion(['Ana Pérez', 'Ana Pérez Soto'], ['Ana Pérez Soto']),
      { 'Ana Pérez Soto': ['Ana Pérez'] }
    );
    const current = record({ nursesDayShift: ['Ana Pérez', ''] });
    const rawProposal: NursingStaffingProposal = {
      ...proposal,
      day: { ...inferred, names: ['Ana Pérez Soto'] },
    };

    expect(buildNursingShiftProposalPatch(current, rawProposal)).toBeNull();
  });

  it('quarantines an exact candidate reused as another candidate observed label', () => {
    const inferred = suggestion(['Ana Pérez', 'Ana Pérez Soto'], ['Ana Pérez Soto']);
    const contradictory = {
      ...inferred,
      candidates: inferred.candidates.map(candidate =>
        candidate.name === 'Ana Pérez Soto'
          ? { ...candidate, observedNames: ['Ana Pérez'] }
          : candidate
      ),
    };
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: contradictory,
    });

    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(record(), review)).toBeNull();
  });

  it('finds catalog collisions for authoritative compound-surname aliases', () => {
    const review = reconcileNursingShiftProposal(
      record({ nursesDayShift: ['Ana de la Fuente', ''] }),
      {
        ...proposal,
        day: withIdentityAliases(
          suggestion(
            ['Ana de la Fuente Soto'],
            ['Ana de la Fuente Soto', 'Ana de la Fuente Rojas']
          ),
          { 'Ana de la Fuente Soto': ['Ana de la Fuente'] }
        ),
      }
    );

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
  });

  it('finds occupied compound-surname conflicts even when absent from the catalog', () => {
    const current = record({
      nursesDayShift: ['Ana de la Fuente', 'Ana de la Fuente Rojas'],
    });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: withIdentityAliases(suggestion(['Ana de la Fuente Soto'], ['Ana de la Fuente Soto']), {
        'Ana de la Fuente Soto': ['Ana de la Fuente'],
      }),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
  });

  it('does not reinterpret an exact canonical candidate as a structural alias', () => {
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: suggestion(
        ['Ana de la Fuente'],
        ['Ana de la Fuente', 'Ana de la Fuente Soto', 'Ana de la Fuente Rojas']
      ),
    });

    expect(review.day.names).toEqual(['Ana de la Fuente']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('does not treat a canonical candidate self-alias as a collision', () => {
    const review = reconcileNursingShiftProposal(record(), {
      ...proposal,
      day: withIdentityAliases(suggestion(['Ana Pérez'], ['Ana Pérez']), {
        'Ana Pérez': ['Ana Pérez'],
      }),
    });

    expect(review.day.names).toEqual(['Ana Pérez']);
    expect(review.day.ambiguous).toBe(false);
  });

  it('quarantines a legacy short/full proposal without structured alias evidence', () => {
    const current = record({ nursesDayShift: ['Pedro Moreno', ''] });
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion(['Pedro Moreno Opazo'], ['Pedro Moreno Opazo']),
    });

    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
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
});
