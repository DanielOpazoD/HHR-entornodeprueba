import { describe, expect, it } from 'vitest';
import { buildUpcNoCriteriaEvaluation } from '@/domain/upc/upcNoCriteriaEvaluation';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

const actor = { uid: 'uid-1', displayName: 'Enfermera Turno' };
const baseInput = {
  actor,
  date: '2026-09-15',
  bedId: 'R2',
  nurseName: '  Enfermera Turno  ',
  nurseFromShift: true,
  evaluationId: 'eval-1',
  evaluatedAt: '2026-09-15T12:00:00.000Z',
};

describe('buildUpcNoCriteriaEvaluation', () => {
  it('signs an empty checklist for the census day and trims the responsible nurse', () => {
    const record = buildUpcNoCriteriaEvaluation(baseInput);

    expect(record).toMatchObject({
      evaluationId: 'eval-1',
      uciCriteria: [],
      utiCriteria: [],
      classification: null,
      evaluatedAt: '2026-09-15T12:00:00.000Z',
      evaluatedBy: actor,
      evaluatedForDate: '2026-09-15',
      evaluatedBedId: 'R2',
      reviewRequired: false,
      responsibleNurse: { name: 'Enfermera Turno', source: 'assigned' },
    });
    expect(record.criterionLabels).toEqual([]);
    // La evaluación firmada queda como la entrada vigente del día en el historial.
    expect(record.history).toHaveLength(1);
    expect(record.history?.[0]).toMatchObject({
      classification: null,
      evaluatedForDate: '2026-09-15',
    });
  });

  it('keeps the earlier evaluation of the same day in the history', () => {
    const previous: UpcChecklistRecord = {
      uciCriteria: ['uci_vmi'],
      utiCriteria: [],
      classification: 'UPC_UCI',
      evaluatedAt: '2026-09-15T08:00:00.000Z',
      evaluatedForDate: '2026-09-15',
      evaluatedBedId: 'R2',
      responsibleNurse: { name: 'Enfermera Anterior', source: 'manual' },
    };

    const record = buildUpcNoCriteriaEvaluation({ ...baseInput, checklist: previous });

    expect(record.classification).toBeNull();
    // El historial se ordena del más reciente al más antiguo.
    expect(record.history?.map(entry => entry.classification)).toEqual([null, 'UPC_UCI']);
  });

  it('records a manual responsible when the name is not from the shift', () => {
    const record = buildUpcNoCriteriaEvaluation({ ...baseInput, nurseFromShift: false });

    expect(record.responsibleNurse).toEqual({
      name: 'Enfermera Turno',
      source: 'manual',
    });
  });
});
