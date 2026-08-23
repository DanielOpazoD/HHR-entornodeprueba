import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { extractTime } from '../mapping/rayenToPatientData';
import { normalizePatientRut } from './censusPatientIdentityIndex';

interface RecordedOutcomeSubject {
  clinicalEpisodeId?: string;
  rut?: string;
  admissionDay?: string;
  admissionTime?: string;
}

/** Matches an episode already resolved in HHR by alta, traslado or CMA. */
export const createRecordedOutcomeMatcher = (
  current: DailyRecord
): ((subject: RecordedOutcomeSubject) => boolean) => {
  const outcomes: RecordedOutcomeSubject[] = [];
  for (const record of [
    ...(current.discharges ?? []),
    ...(current.cma ?? []),
    ...(current.transfers ?? []),
  ]) {
    if (record.deletedAt) continue;
    const recordRut = normalizePatientRut(record.rut);
    outcomes.push({
      clinicalEpisodeId: record.clinicalEpisodeId,
      rut: recordRut,
      admissionDay:
        ('admissionDate' in record ? record.admissionDate : undefined) ||
        record.originalData?.admissionDate ||
        record.originalData?.firstSeenDate,
      admissionTime: record.originalData?.admissionTime,
    });
  }
  return subject => {
    const subjectRut = normalizePatientRut(subject.rut);
    return outcomes.some(outcome => {
      if (subject.clinicalEpisodeId && outcome.clinicalEpisodeId) {
        return subject.clinicalEpisodeId === outcome.clinicalEpisodeId;
      }
      if (!subjectRut || subjectRut !== outcome.rut) return false;
      // Without two episode IDs, only a complete matching admission timestamp is safe.
      // Same-RUT admissions can occur more than once on the same day.
      return Boolean(
        subject.admissionDay &&
        outcome.admissionDay &&
        subject.admissionDay === outcome.admissionDay &&
        subject.admissionTime &&
        outcome.admissionTime &&
        subject.admissionTime === outcome.admissionTime
      );
    });
  };
};

export const createDischargedEncounterMatcher = (
  current: DailyRecord
): ((encounter: RayenEncounter) => boolean) => {
  const hasRecordedOutcome = createRecordedOutcomeMatcher(current);
  return encounter =>
    hasRecordedOutcome({
      clinicalEpisodeId: encounter.encounterId,
      rut: encounter.run,
      admissionDay: encounter.admissionDatetime?.slice(0, 10),
      admissionTime: extractTime(encounter.admissionDatetime),
    });
};
