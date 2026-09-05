import type { UpcChecklistRecord, UpcEvaluationSnapshot } from './upcContracts';
import { UPC_UCI_CRITERIA, UPC_UTI_CRITERIA, normalizeUciCriterionId } from './upcCriteria';

const labels = new Map([...UPC_UCI_CRITERIA, ...UPC_UTI_CRITERIA].map(c => [c.id, c.label]));

export const upcCriterionLabels = (entry: UpcEvaluationSnapshot): string[] =>
  entry.criterionLabels ??
  [...entry.uciCriteria, ...entry.utiCriteria].map(
    id => labels.get(normalizeUciCriterionId(id)) || id
  );

/** Strip mutable review state and nested history before archiving. */
export const upcEvaluationSnapshot = (entry: UpcChecklistRecord): UpcEvaluationSnapshot => ({
  uciCriteria: [...entry.uciCriteria],
  utiCriteria: [...entry.utiCriteria],
  classification: entry.classification,
  evaluatedAt: entry.evaluatedAt,
  ...(entry.evaluationId ? { evaluationId: entry.evaluationId } : {}),
  ...(entry.criterionLabels ? { criterionLabels: [...entry.criterionLabels] } : {}),
  ...(entry.evaluatedBy ? { evaluatedBy: { ...entry.evaluatedBy } } : {}),
  ...(entry.evaluatedForDate ? { evaluatedForDate: entry.evaluatedForDate } : {}),
  ...(entry.evaluatedBedId ? { evaluatedBedId: entry.evaluatedBedId } : {}),
  ...(entry.responsibleNurse ? { responsibleNurse: { ...entry.responsibleNurse } } : {}),
});

export const upcEvaluationKey = (entry: UpcEvaluationSnapshot): string =>
  entry.evaluationId || JSON.stringify(upcEvaluationSnapshot(entry));

/** Copied-day snapshots and the current value appear only once. Untimed placeholders are not evaluations. */
export const mergeUpcEvaluationHistory = (
  ...groups: (readonly UpcEvaluationSnapshot[])[]
): UpcEvaluationSnapshot[] => {
  const entries = new Map<string, UpcEvaluationSnapshot>();
  for (const entry of groups.flat()) {
    if (Number.isFinite(Date.parse(entry.evaluatedAt))) {
      entries.set(upcEvaluationKey(entry), upcEvaluationSnapshot(entry));
    }
  }
  return [...entries.values()].sort(
    (a, b) => Date.parse(b.evaluatedAt) - Date.parse(a.evaluatedAt)
  );
};

export const checklistUpcHistory = (checklist?: UpcChecklistRecord): UpcEvaluationSnapshot[] =>
  checklist ? mergeUpcEvaluationHistory(checklist.history ?? [], [checklist]) : [];

export const appendUpcEvaluation = (
  previous: UpcChecklistRecord | undefined,
  next: UpcChecklistRecord
): UpcChecklistRecord => ({
  ...next,
  // Avoid copying an ever-growing stay journal into every census day. The reader joins days.
  // Legacy untargeted snapshots stay visible rather than inventing their reviewed census date.
  history: mergeUpcEvaluationHistory(
    checklistUpcHistory(previous).filter(
      entry => !entry.evaluatedForDate || entry.evaluatedForDate === next.evaluatedForDate
    ),
    [next]
  ),
});
