import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeEntry } from '../contracts/censusImportDiff';
import { matchesDischargeSubject } from './dischargeSubjectIdentity';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { ReportEgreso } from '../contracts/egresoReport';
import { extractTime } from '../mapping/rayenToPatientData';
import { normalizePatientRut } from './censusPatientIdentityIndex';

interface RecordedOutcomeSubject {
  clinicalEpisodeId?: string;
  rut?: string;
  admissionDay?: string;
  admissionTime?: string;
}

type RecordedOutcome =
  | DailyRecord['discharges'][number]
  | DailyRecord['cma'][number]
  | DailyRecord['transfers'][number];

/** Reads legacy episode provenance behind the single governed historical compatibility boundary. */
export const recordedOutcomeEpisodeId = (movement: RecordedOutcome): string | undefined =>
  movement.clinicalEpisodeId ?? movement.originalData?.clinicalEpisodeId;

/** Resolve legacy undo provenance only inside this historical compatibility boundary. */
export const recordedOutcomeMatchesDischarge = (
  movement: RecordedOutcome,
  entry: DischargeEntry
): boolean =>
  !movement.deletedAt &&
  matchesDischargeSubject(
    {
      ...movement.originalData,
      clinicalEpisodeId: recordedOutcomeEpisodeId(movement),
      rut: movement.rut,
      patientName: movement.patientName,
    } as PatientData,
    entry
  );

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

/** Check the current accumulated movements, including outcomes created earlier in this import. */
export const hasRecordedReportOutcome = (current: DailyRecord, report: ReportEgreso): boolean =>
  createRecordedOutcomeMatcher(current)({
    clinicalEpisodeId: report.encounterId,
    rut: report.run,
    admissionDay: report.admissionDay,
    admissionTime: report.admissionTime,
  });

/** A reported or already resolved crib episode must not be inferred again from its mother's alta. */
export const hasIndependentClinicalCribOutcome = (
  current: DailyRecord,
  reports: readonly ReportEgreso[] | undefined,
  crib: PatientData | undefined
): boolean => {
  if (!crib?.clinicalEpisodeId) return false;
  return Boolean(
    reports?.some(
      report =>
        report.fromClinicalCrib === true &&
        (!report.correctedDay || report.correctedDay === current.date.slice(0, 10)) &&
        report.encounterId === crib.clinicalEpisodeId
    ) ||
    createRecordedOutcomeMatcher(current)({
      clinicalEpisodeId: crib.clinicalEpisodeId,
      rut: crib.rut,
      admissionDay: crib.admissionDate,
      admissionTime: crib.admissionTime,
    })
  );
};
