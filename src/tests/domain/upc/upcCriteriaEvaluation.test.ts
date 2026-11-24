// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildUpcCriteriaEvaluation } from '@/domain/upc/upcCriteriaEvaluation';
import { hasSignedUpcEvaluation } from '@/domain/upc/upcEvaluationHistory';
import { UpcChecklistSchema } from '@/schemas/zod/upc';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

const actor = { uid: 'uid-1', displayName: 'Enfermera Turno' };
const baseInput = {
  actor,
  date: '2026-09-15',
  bedId: 'R2',
  uciCriteria: [],
  utiCriteria: [],
  evaluationId: 'eval-1',
  evaluatedAt: '2026-09-15T12:00:00.000Z',
};

describe('buildUpcCriteriaEvaluation', () => {
  it('signs an empty checklist for the census day with the authenticated professional', () => {
    const record = buildUpcCriteriaEvaluation(baseInput);

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
      signatureSource: 'session',
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

    const record = buildUpcCriteriaEvaluation({ ...baseInput, checklist: previous });

    expect(record.classification).toBeNull();
    // El historial se ordena del más reciente al más antiguo.
    expect(record.history?.map(entry => entry.classification)).toEqual([null, 'UPC_UCI']);
  });

  it('retains the session signature when the stored checklist is parsed again', () => {
    const record = buildUpcCriteriaEvaluation(baseInput);
    const parsed = UpcChecklistSchema.parse(JSON.parse(JSON.stringify(record)));
    expect(hasSignedUpcEvaluation(parsed)).toBe(true);
    expect(hasSignedUpcEvaluation(parsed.history?.[0])).toBe(true);
    expect(parsed.responsibleNurse).toBeUndefined();
  });
});
