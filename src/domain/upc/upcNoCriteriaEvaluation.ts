import { appendUpcEvaluation, upcCriterionLabels } from './upcEvaluationHistory';
import { resolveUpcClassification } from './upcClassification';
import type { UpcChecklistAuditActor, UpcChecklistRecord } from './upcContracts';

export interface BuildUpcNoCriteriaEvaluationInput {
  checklist?: UpcChecklistRecord;
  actor: UpcChecklistAuditActor;
  /** Census day being signed, never the wall-clock day. */
  date: string;
  bedId: string;
  nurseName: string;
  /** True when the name was picked from the shift's assigned UPC nurses. */
  nurseFromShift: boolean;
  /** Stable id so a transport retry signs the same evaluation. */
  evaluationId: string;
  evaluatedAt: string;
}

/**
 * Explicit "sin criterios UPC" evaluation for one bed: the day is closed with an empty checklist and
 * the responsible nurse on record, keeping the previous evaluations in the history.
 */
export const buildUpcNoCriteriaEvaluation = ({
  checklist,
  actor,
  date,
  bedId,
  nurseName,
  nurseFromShift,
  evaluationId,
  evaluatedAt,
}: BuildUpcNoCriteriaEvaluationInput): UpcChecklistRecord => {
  const evaluation: UpcChecklistRecord = {
    evaluationId,
    uciCriteria: [],
    utiCriteria: [],
    classification: null,
    evaluatedAt,
    evaluatedBy: actor,
    evaluatedForDate: date,
    evaluatedBedId: bedId,
    reviewRequired: false,
    responsibleNurse: {
      name: nurseName.trim(),
      source: nurseFromShift ? 'assigned' : 'manual',
    },
  };

  return appendUpcEvaluation(checklist, {
    ...evaluation,
    criterionLabels: upcCriterionLabels(evaluation),
  });
};

export interface BuildUpcCriteriaEvaluationInput extends Omit<
  BuildUpcNoCriteriaEvaluationInput,
  'nurseFromShift'
> {
  uciCriteria: string[];
  utiCriteria: string[];
}

/** Evaluation signed from the criteria checked in the day panel; classification is derived. */
export const buildUpcCriteriaEvaluation = ({
  checklist,
  actor,
  date,
  bedId,
  nurseName,
  nurseFromShift,
  evaluationId,
  evaluatedAt,
  uciCriteria,
  utiCriteria,
}: BuildUpcCriteriaEvaluationInput & { nurseFromShift: boolean }): UpcChecklistRecord => {
  const evaluation: UpcChecklistRecord = {
    evaluationId,
    uciCriteria: [...uciCriteria],
    utiCriteria: [...utiCriteria],
    classification: resolveUpcClassification({
      uciCriteria: new Set(uciCriteria),
      utiCriteria: new Set(utiCriteria),
    }),
    evaluatedAt,
    evaluatedBy: actor,
    evaluatedForDate: date,
    evaluatedBedId: bedId,
    reviewRequired: false,
    responsibleNurse: {
      name: nurseName.trim(),
      source: nurseFromShift ? 'assigned' : 'manual',
    },
  };

  return appendUpcEvaluation(checklist, {
    ...evaluation,
    criterionLabels: upcCriterionLabels(evaluation),
  });
};
