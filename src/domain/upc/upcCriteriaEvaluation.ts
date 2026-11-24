import { appendUpcEvaluation, upcCriterionLabels } from './upcEvaluationHistory';
import { resolveUpcClassification } from './upcClassification';
import type { UpcChecklistAuditActor, UpcChecklistRecord } from './upcContracts';

interface UpcEvaluationInput {
  checklist?: UpcChecklistRecord;
  actor: UpcChecklistAuditActor;
  date: string;
  bedId: string;
  evaluationId: string;
  evaluatedAt: string;
  uciCriteria: string[];
  utiCriteria: string[];
}

/** Sign the selected criteria, including an explicit evaluation with no criteria. */
export const buildUpcCriteriaEvaluation = ({
  checklist,
  actor,
  date,
  bedId,
  evaluationId,
  evaluatedAt,
  uciCriteria,
  utiCriteria,
}: UpcEvaluationInput): UpcChecklistRecord => {
  const evaluation: UpcChecklistRecord = {
    evaluationId,
    uciCriteria,
    utiCriteria,
    classification: resolveUpcClassification({
      uciCriteria: new Set(uciCriteria),
      utiCriteria: new Set(utiCriteria),
    }),
    evaluatedAt,
    evaluatedBy: actor,
    signatureSource: 'session',
    evaluatedForDate: date,
    evaluatedBedId: bedId,
    reviewRequired: false,
  };
  return appendUpcEvaluation(checklist, {
    ...evaluation,
    criterionLabels: upcCriterionLabels(evaluation),
  });
};
