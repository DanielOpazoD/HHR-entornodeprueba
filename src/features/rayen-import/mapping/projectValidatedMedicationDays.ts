import type { ClinicalPanelEntry } from './parseClinicalPanel';
import { dayKey, flag, timeKey } from './clinicalPanelParsingUtils';

type MedicationState = Record<string, unknown>;

interface ProjectValidatedMedicationDaysInput {
  treatmentValidations: string[];
  candidatesByMedicationId: Map<string, ClinicalPanelEntry[]>;
  sourceMedicationDays: Set<string>;
  medicationStates: Map<string, MedicationState>;
}

const earliestInactiveDates = (states: Map<string, MedicationState>): Map<string, string> => {
  const result = new Map<string, string>();
  for (const [medicationId, state] of states) {
    for (const value of [
      state.programmingEndDatetime,
      state.programmingEndDateTime,
      state.endDateTime,
      state.deletedDateTime,
    ]) {
      const candidate = value === null || value === undefined ? '' : String(value).trim();
      if (timeKey(candidate) <= 0) continue;
      const current = result.get(medicationId);
      if (!current || timeKey(candidate) < timeKey(current)) result.set(medicationId, candidate);
    }
  }
  return result;
};

const latestValidationByDay = (validations: string[]): Map<string, string> => {
  const result = new Map<string, string>();
  for (const validation of validations) {
    const day = dayKey(validation);
    if (!day) continue;
    const current = result.get(day);
    if (!current || timeKey(validation) > timeKey(current)) result.set(day, validation);
  }
  return result;
};

const versionAt = (
  candidates: ClinicalPanelEntry[],
  validationDatetime: string
): ClinicalPanelEntry | null =>
  candidates.reduce<ClinicalPanelEntry | null>((selected, candidate) => {
    const candidateTime = timeKey(candidate.prescribedAt ?? candidate.publishedAt);
    if (candidateTime <= 0 || candidateTime > timeKey(validationDatetime)) return selected;
    if (!selected || candidateTime > timeKey(selected.prescribedAt ?? selected.publishedAt)) {
      return candidate;
    }
    return selected;
  }, null);

export const projectValidatedMedicationDays = ({
  treatmentValidations,
  candidatesByMedicationId,
  sourceMedicationDays,
  medicationStates,
}: ProjectValidatedMedicationDaysInput): ClinicalPanelEntry[] => {
  const projected: ClinicalPanelEntry[] = [];
  const inactiveDates = earliestInactiveDates(medicationStates);
  for (const [validationDay, validationDatetime] of latestValidationByDay(treatmentValidations)) {
    for (const [medicationId, candidates] of candidatesByMedicationId) {
      const medication = versionAt(candidates, validationDatetime);
      if (!medication || sourceMedicationDays.has(`${medicationId}:${validationDay}`)) continue;
      const prescribedAt = medication.prescribedAt ?? medication.publishedAt;
      if (!dayKey(prescribedAt) || dayKey(prescribedAt) > validationDay) continue;
      const inactiveAt = inactiveDates.get(medicationId);
      if (inactiveAt && timeKey(validationDatetime) >= timeKey(inactiveAt)) continue;
      const currentState = medicationStates.get(medicationId);
      if (!currentState) continue;
      const currentlyInactive =
        flag(currentState.suspended) || flag(currentState.archived) || flag(currentState.finalized);
      if (!inactiveAt && currentlyInactive) continue;
      projected.push({
        ...medication,
        publishedAt: validationDatetime,
        prescribedAt,
        archived: false,
        suspended: false,
        finalized: false,
        validitySource: 'daily-validation',
      });
    }
  }
  return projected;
};
