import { describe, expect, it } from 'vitest';
import {
  buildNursingShiftProposalPatch,
  hasPendingStaffingDecision,
  hasNursingShiftReview,
  reconcileNursingShiftProposal,
} from '@/features/rayen-import/domain/applyNursingShiftProposal';
import type { NursingStaffingProposal } from '@/features/rayen-import/contracts/nursingShiftInference';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

const suggestion = (
  names: string[],
  tied = false,
  catalogMatched = false,
  catalogNames = catalogMatched ? names : []
) => ({
  names,
  catalogNames,
  candidates: names.map((name, index) => ({
    name,
    observedNames: [name],
    records: 2,
    patients: 2,
    activeHours: 2,
    score: tied ? 16 : 16 - index,
    hasShiftChange: false,
    catalogMatched,
  })),
  ignoredBoundaryRecords: 0,
  ambiguous: false,
});

const withObservedNames = (
  value: ReturnType<typeof suggestion>,
  name: string,
  observedNames: string[]
): ReturnType<typeof suggestion> => ({
  ...value,
  candidates: value.candidates.map(candidate =>
    candidate.name === name ? { ...candidate, observedNames } : candidate
  ),
});

const proposal: NursingStaffingProposal = {
  censusDate: '2026-07-20',
  day: suggestion(['Ana', 'Berta']),
  night: suggestion(['Carla', 'Daniela']),
};

const record = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-07-20',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    nursesDayShift: ['', 'Manual'],
    nursesNightShift: ['Vacante', '--'],
    tensDayShift: ['TENS Día', '', ''],
    tensNightShift: ['TENS Noche', '', ''],
    lastUpdated: '',
    ...overrides,
  }) as DailyRecord;

describe('buildNursingShiftProposalPatch', () => {
  it('keeps a TENS-only vacancy or ambiguity pending for explicit review', () => {
    expect(
      hasPendingStaffingDecision({
        ...proposal,
        day: suggestion([]),
        night: suggestion([]),
        tensDay: suggestion(['Jimena Yáñez']),
      })
    ).toBe(true);
    expect(
      hasPendingStaffingDecision({
        ...proposal,
        day: suggestion([]),
        night: suggestion([]),
        tensNight: { ...suggestion([]), ambiguous: true },
      })
    ).toBe(true);
  });

  it('fills only vacant nurse slots and preserves manual nursing and TENS assignments', () => {
    const patch = buildNursingShiftProposalPatch(record(), proposal);

    expect(patch).toMatchObject({
      nursesDayShift: ['Ana', 'Manual'],
      nursesNightShift: ['Carla', 'Daniela'],
      tensDayShift: ['TENS Día', '', ''],
      tensNightShift: ['TENS Noche', '', ''],
    });
    expect(patch?.staffingDetailsV1).toBeDefined();
  });

  it('fills up to three verified TENS slots while preserving a true vacancy', () => {
    const patch = buildNursingShiftProposalPatch(
      record({ tensDayShift: ['', '', ''], tensNightShift: ['', '', ''] }),
      {
        ...proposal,
        day: suggestion([]),
        night: suggestion([]),
        tensDay: suggestion(['Jimena Yáñez', 'Paula Soto']),
        tensNight: suggestion(['Mario Rojas']),
      }
    );

    expect(patch?.tensDayShift).toEqual(['Jimena Yáñez', 'Paula Soto', '']);
    expect(patch?.tensNightShift).toEqual(['Mario Rojas', '', '']);
  });

  it('never replaces an existing TENS roster from inferred activity', () => {
    const current = record({ tensDayShift: ['TENS 1', 'TENS 2', 'TENS 3'] });
    const inferred = suggestion(['Nuevo 1', 'Nuevo 2', 'Nuevo 3']);
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: suggestion([]),
      night: suggestion([]),
      tensDay: inferred,
    });

    expect(review.tensDay?.replaceStandardSlots).toBe(false);
    expect(review.tensDay?.names).toEqual([]);
    expect(
      buildNursingShiftProposalPatch(current, {
        ...proposal,
        day: suggestion([]),
        night: suggestion([]),
        tensDay: {
          ...inferred,
          currentNames: ['TENS 1', 'TENS 2', 'TENS 3'],
          replaceStandardSlots: true,
        },
      })
    ).toBeNull();
  });

  it('does not duplicate a nurse already assigned to the shift', () => {
    const patch = buildNursingShiftProposalPatch(record({ nursesDayShift: ['Ana', ''] }), proposal);
    expect(patch?.nursesDayShift).toEqual(['Ana', 'Berta']);
  });

  it('uses canonical identity when the fresh record contains a longer alias', () => {
    const patch = buildNursingShiftProposalPatch(
      record({ nursesDayShift: ['Ana Pérez Opazo', ''] }),
      {
        ...proposal,
        day: withObservedNames(suggestion(['Ana Pérez', 'Berta Soto'], false, true), 'Ana Pérez', [
          'Ana Pérez Opazo',
        ]),
        night: suggestion([]),
      }
    );

    expect(patch?.nursesDayShift).toEqual(['Ana Pérez Opazo', 'Berta Soto']);
  });

  it('keeps two full homonyms distinct when only their first surname matches', () => {
    const patch = buildNursingShiftProposalPatch(
      record({ nursesDayShift: ['Ana Pérez Soto', ''] }),
      { ...proposal, day: suggestion(['Ana Pérez Rojas']), night: suggestion([]) }
    );

    expect(patch?.nursesDayShift).toEqual(['Ana Pérez Soto', 'Ana Pérez Rojas']);
  });

  it('does not fill both vacancies when evidence resolves aliases to one nurse', () => {
    const patch = buildNursingShiftProposalPatch(record({ nursesDayShift: ['', ''] }), {
      ...proposal,
      day: {
        ...suggestion(['Ana Pérez']),
        candidates: [
          {
            ...suggestion(['Ana Pérez']).candidates[0],
            observedNames: ['Ana Pérez', 'Ana Pérez Soto'],
          },
        ],
      },
      night: suggestion([]),
    });

    expect(patch?.nursesDayShift).toEqual(['Ana Pérez', '']);
  });

  it('preserves short and full names when both are distinct exact catalog identities', () => {
    const patch = buildNursingShiftProposalPatch(record({ nursesDayShift: ['', ''] }), {
      ...proposal,
      day: suggestion(['Pedro Moreno', 'Pedro Moreno Opazo'], false, true),
      night: suggestion([]),
    });

    expect(patch?.nursesDayShift).toEqual(['Pedro Moreno', 'Pedro Moreno Opazo']);
  });

  it('does not mark a distinct exact catalog identity as already synchronized', () => {
    const review = reconcileNursingShiftProposal(record({ nursesDayShift: ['Pedro Moreno', ''] }), {
      ...proposal,
      day: suggestion(['Pedro Moreno Opazo'], false, true, ['Pedro Moreno', 'Pedro Moreno Opazo']),
      night: suggestion([]),
    });

    expect(review.day.names).toEqual(['Pedro Moreno Opazo']);
    expect(review.day.alreadyAssigned).toEqual([]);
  });

  it('does not choose alphabetically when two tied nurses compete for one vacancy', () => {
    const oneVacancy = record({ nursesDayShift: ['Manual', ''] });
    const tiedProposal = {
      ...proposal,
      day: suggestion(['Ana Pérez', 'Berta Soto'], true),
      night: suggestion([]),
    };

    const review = reconcileNursingShiftProposal(oneVacancy, tiedProposal);
    expect(review.day.names).toEqual([]);
    expect(review.day.ambiguous).toBe(true);
    expect(buildNursingShiftProposalPatch(oneVacancy, tiedProposal)).toBeNull();
  });

  it('does not duplicate a nurse assigned in an additional staffing slot', () => {
    const withExtra = record({ nursesDayShift: ['', ''] });
    withExtra.staffingDetailsV1 = resolveDetailedStaffingState(withExtra, withExtra.date);
    withExtra.staffingDetailsV1.day.nurses.push({
      id: 'day-nurse-extra-test',
      name: 'Ana Pérez',
      role: 'nurse',
      slotType: 'extra',
      startTime: '08:00',
      endTime: '20:00',
    });

    const patch = buildNursingShiftProposalPatch(withExtra, {
      ...proposal,
      day: suggestion(['Ana Pérez', 'Berta Soto']),
      night: suggestion([]),
    });

    expect(patch?.nursesDayShift).toEqual(['Berta Soto', '']);
    expect(patch?.staffingDetailsV1?.day.nurses).toContainEqual(
      expect.objectContaining({ id: 'day-nurse-extra-test', name: 'Ana Pérez' })
    );
  });

  it('promotes the next eligible candidate after an inferred nurse is already assigned', () => {
    const withExtra = record({ nursesDayShift: ['', ''] });
    withExtra.staffingDetailsV1 = resolveDetailedStaffingState(withExtra, withExtra.date);
    withExtra.staffingDetailsV1.day.nurses.push({
      id: 'day-nurse-extra-promote',
      name: 'Ana Pérez',
      role: 'nurse',
      slotType: 'extra',
      startTime: '08:00',
      endTime: '20:00',
    });
    const threeCandidates = suggestion(['Ana Pérez', 'Berta Soto', 'Carla Rojas']);

    const review = reconcileNursingShiftProposal(withExtra, {
      ...proposal,
      day: { ...threeCandidates, names: ['Ana Pérez', 'Berta Soto'] },
      night: suggestion([]),
    });

    expect(review.day.names).toEqual(['Berta Soto', 'Carla Rojas']);
    expect(review.day.alreadyAssigned).toEqual(['Ana Pérez']);
  });

  it('marks an assigned nurse as synchronized and leaves only vacancies actionable', () => {
    const review = reconcileNursingShiftProposal(
      record({ nursesDayShift: ['Ana Pérez Opazo', ''] }),
      {
        ...proposal,
        day: withObservedNames(suggestion(['Ana Pérez', 'Berta Soto'], false, true), 'Ana Pérez', [
          'Ana Pérez Opazo',
        ]),
        night: suggestion([]),
      }
    );

    expect(review.day.names).toEqual(['Berta Soto']);
    expect(review.day.alreadyAssigned).toEqual(['Ana Pérez']);
    expect(hasNursingShiftReview(review)).toBe(true);
  });

  it('keeps an all-assigned result as informational review without an apply action', () => {
    const review = reconcileNursingShiftProposal(
      record({ nursesDayShift: ['Ana Pérez', 'Berta Soto'] }),
      {
        ...proposal,
        day: suggestion(['Ana Pérez', 'Berta Soto']),
        night: suggestion([]),
      }
    );

    expect(review.day.names).toEqual([]);
    expect(review.day.alreadyAssigned).toEqual(['Ana Pérez', 'Berta Soto']);
    expect(hasNursingShiftReview(review)).toBe(true);
  });

  it('preserves a detailed manual assignment when its legacy array is temporarily stale', () => {
    const staleRecord = record({ nursesDayShift: ['', ''] });
    staleRecord.staffingDetailsV1 = updateDetailedStaffingStandardSlot(
      resolveDetailedStaffingState(staleRecord, staleRecord.date),
      'day',
      'nurse',
      0,
      'Asignación manual'
    );

    const patch = buildNursingShiftProposalPatch(staleRecord, proposal);

    expect(patch?.nursesDayShift).toEqual(['Asignación manual', 'Ana']);
  });

  it('offers and applies an explicit replacement when both inferred nurses differ', () => {
    const incorrect = record({ nursesDayShift: ['Noche Anterior 1', 'Noche Anterior 2'] });
    const review = reconcileNursingShiftProposal(incorrect, {
      ...proposal,
      night: suggestion([]),
    });

    expect(review.day).toMatchObject({
      names: ['Ana', 'Berta'],
      currentNames: ['Noche Anterior 1', 'Noche Anterior 2'],
      replaceStandardSlots: true,
    });
    expect(buildNursingShiftProposalPatch(incorrect, review)).toMatchObject({
      nursesDayShift: ['Ana', 'Berta'],
      tensDayShift: ['TENS Día', '', ''],
    });
  });

  it('preserves a matching catalog alias while replacing only the incorrect colleague', () => {
    const current = record({ nursesDayShift: ['Ana Pérez Opazo', 'Noche Anterior'] });
    const inferred = withObservedNames(
      suggestion(['Ana Pérez', 'Berta Soto'], false, true),
      'Ana Pérez',
      ['Ana Pérez Opazo']
    );
    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      day: inferred,
      night: suggestion([]),
    });

    expect(review.day.names).toEqual(['Ana Pérez Opazo', 'Berta Soto']);
    expect(buildNursingShiftProposalPatch(current, review)?.nursesDayShift).toEqual([
      'Ana Pérez Opazo',
      'Berta Soto',
    ]);
  });

  it('blocks replacement when an additional nurse assignment exists', () => {
    const current = record({ nursesDayShift: ['Noche 1', 'Noche 2'] });
    current.staffingDetailsV1 = resolveDetailedStaffingState(current, current.date);
    current.staffingDetailsV1.day.nurses.push({
      id: 'day-nurse-extra-guard',
      name: 'Refuerzo',
      role: 'nurse',
      slotType: 'extra',
      startTime: '08:00',
      endTime: '20:00',
    });

    const review = reconcileNursingShiftProposal(current, {
      ...proposal,
      night: suggestion([]),
    });

    expect(review.day.replaceStandardSlots).toBe(false);
    expect(review.day.names).toEqual([]);
    expect(buildNursingShiftProposalPatch(current, review)).toBeNull();
  });

  it('fails closed when the roster changed after the replacement preview', () => {
    const original = record({ nursesDayShift: ['Noche 1', 'Noche 2'] });
    const review = reconcileNursingShiftProposal(original, {
      ...proposal,
      night: suggestion([]),
    });
    const changed = record({ nursesDayShift: ['Turno corregido', 'Noche 2'] });

    expect(buildNursingShiftProposalPatch(changed, review)).toBeNull();
  });

  it('returns null for another census day or when no vacant slot remains', () => {
    expect(buildNursingShiftProposalPatch(record({ date: '2026-07-19' }), proposal)).toBeNull();
    expect(
      buildNursingShiftProposalPatch(
        record({ nursesDayShift: ['Manual 1', 'Manual 2'], nursesNightShift: ['N1', 'N2'] }),
        proposal
      )
    ).toBeNull();
  });
});
