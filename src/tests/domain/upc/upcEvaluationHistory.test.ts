import { describe, expect, it } from 'vitest';
import {
  appendUpcEvaluation,
  checklistUpcHistory,
  mergeUpcEvaluationHistory,
  upcCriterionLabels,
} from '@/domain/upc/upcEvaluationHistory';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { UpcChecklistSchema } from '@/schemas/zod/upc';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';
import { preparePatientForCarryover } from '@/services/repositories/dailyRecordClinicalDomainService';
import { DataFactory } from '@/tests/factories/DataFactory';

const evaluation = (evaluationId: string, hour = 12): UpcChecklistRecord => ({
  evaluationId,
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  evaluatedAt: `2026-09-04T${hour}:00:00Z`,
  evaluatedForDate: '2026-09-04',
  evaluatedBedId: 'R1',
  evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
  responsibleNurse: { name: 'Enfermera A', source: 'assigned' },
  reviewRequired: false,
});

describe('UPC evaluation journal', () => {
  it('retains each same-day evaluation, including No UPC, without nesting mutable history', () => {
    const first = evaluation('first');
    const second = {
      ...evaluation('second', 13),
      uciCriteria: ['uci_vmi'],
      classification: 'UPC_UCI' as const,
    };
    const saved = appendUpcEvaluation(first, second);
    expect(checklistUpcHistory(saved).map(entry => entry.evaluationId)).toEqual([
      'second',
      'first',
    ]);
    expect(saved.history![1].classification).toBeNull();
    expect(saved.history![0]).not.toHaveProperty('reviewRequired');
    expect(saved.history![0]).not.toHaveProperty('history');
    expect(first).not.toHaveProperty('history');
    expect(checklistUpcHistory(appendUpcEvaluation(saved, second))).toHaveLength(2);
  });
  it('keeps the previous day in its original record, and joins copied snapshots only once', () => {
    const yesterday = appendUpcEvaluation(evaluation('morning'), evaluation('evening', 18));
    const patient = DataFactory.createMockPatient('R1', { upcChecklist: yesterday });
    const carried = preparePatientForCarryover(patient);
    const tomorrow = appendUpcEvaluation(carried.upcChecklist, {
      ...evaluation('tomorrow'),
      evaluatedAt: '2026-09-05T12:00:00Z',
      evaluatedForDate: '2026-09-05',
    });
    expect(tomorrow.history).toHaveLength(1);
    expect(yesterday.history).toHaveLength(2);
    expect(
      mergeUpcEvaluationHistory(
        checklistUpcHistory(yesterday),
        checklistUpcHistory(carried.upcChecklist),
        checklistUpcHistory(tomorrow)
      )
    ).toHaveLength(3);
  });
  it('retains old audit, labels and No UPC through JSON/schema round-trip and bed movement', () => {
    const signed = appendUpcEvaluation(evaluation('first'), {
      ...evaluation('second', 13),
      criterionLabels: ['Texto firmado'],
    });
    const parsed = UpcChecklistSchema.parse(JSON.parse(JSON.stringify(signed)));
    expect(parsed).toEqual(signed);
    const moved = normalizePatientUpcForBed({ bedId: 'R1', upcChecklist: signed }, 'R2');
    expect(moved.upcChecklist?.reviewRequired).toBe(true);
    expect(moved.upcChecklist?.history).toEqual(signed.history);
    expect(upcCriterionLabels(signed)).toEqual(['Texto firmado']);
  });
  it('does not invent evaluations for empty placeholders, but preserves legacy missing audit', () => {
    expect(checklistUpcHistory({ ...evaluation('empty'), evaluatedAt: '' })).toEqual([]);
    const legacy = {
      ...evaluation('old'),
      evaluationId: undefined,
      evaluatedBy: undefined,
      evaluatedForDate: undefined,
    };
    const saved = appendUpcEvaluation(legacy, evaluation('new', 13));
    expect(checklistUpcHistory(saved)).toHaveLength(2);
    expect(saved.history![1]).not.toHaveProperty('evaluatedBy');
    expect(saved.history![1]).not.toHaveProperty('evaluatedForDate');
  });
});
