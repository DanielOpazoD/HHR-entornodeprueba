import { z } from 'zod';
import { BEDS } from '@/constants/beds';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { getActiveDischarges } from '@/application/census/movementTombstonePolicy';
import { normalizeRut } from '@/utils/rutUtils';
import type { DischargeData } from '@/types/domain/movements';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeEntry, ClinicalCribDischargeRepair } from '../contracts/censusImportDiff';
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
      clinicalEpisodeId: recordedOutcomeEpisodeId(record),
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

// Historical repair eligibility reads undo provenance only within this governed boundary.
const bedIds = new Set(BEDS.map(bed => bed.id));
const sparseSnapshotFields = new Set([
  'patientName',
  'rut',
  'pathology',
  'specialty',
  'age',
  'clinicalEpisodeId',
  'admissionDate',
  'admissionTime',
]);
const isImportedCribDeparture = (row: DischargeData, date: string): boolean =>
  row.isNested === true &&
  row.movementDate === date &&
  row.movementProvenance?.source === 'gestion_camas' &&
  Boolean(row.clinicalEpisodeId?.trim()) &&
  row.originalData?.clinicalEpisodeId === row.clinicalEpisodeId &&
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time);
const isCanonicalDeparture = (row: DischargeData): boolean =>
  bedIds.has(row.bedId) &&
  Boolean(row.admissionDate && row.originalData?.admissionDate === row.admissionDate);
// Repository parsing adds defaults and derives name parts even to report-only snapshots.
// Compare those extra fields against the actual schema, never against arbitrary empty values:
// devices, notes, manual identity corrections and unknown fields still prevent a repair.
const hasOnlyReportSnapshotData = (snapshot: PatientData | undefined): boolean => {
  if (!snapshot) return false;
  const entries = Object.entries(snapshot);
  const minimal = Object.fromEntries(entries.filter(([key]) => sparseSnapshotFields.has(key)));
  const normalized = PatientDataSchema.safeParse(minimal);
  if (!normalized.success) return false;
  const defaults = new Map(Object.entries(normalized.data));
  return entries.every(
    ([key, value]) =>
      sparseSnapshotFields.has(key) ||
      (defaults.has(key) && JSON.stringify(value) === JSON.stringify(defaults.get(key)))
  );
};
const importClassificationTimestampSchema = z.string().datetime({ offset: true });
const isSameImportBatch = (left: DischargeData, right: DischargeData): boolean => {
  const a = left.movementProvenance;
  const b = right.movementProvenance;
  return Boolean(
    a?.source === 'gestion_camas' &&
    b?.source === 'gestion_camas' &&
    a.syncRunId.trim() &&
    a.syncRunId === b.syncRunId &&
    importClassificationTimestampSchema.safeParse(a.classifiedAt).success &&
    a.classifiedAt === b.classifiedAt
  );
};
const isMalformedReportCopy = (row: DischargeData): boolean =>
  /^cuna\s+/i.test(row.bedId) &&
  !row.admissionDate &&
  !row.originalData?.admissionDate &&
  !row.ieehData &&
  hasOnlyReportSnapshotData(row.originalData);

/** Only the known two-path import defect; ambiguous identities or enriched rows are not repaired. */
export const planClinicalCribDischargeRepairs = (
  record: DailyRecord
): ClinicalCribDischargeRepair[] => {
  const active = getActiveDischarges(record.discharges);
  const candidates = active.filter(row => isImportedCribDeparture(row, record.date));
  const repairs: ClinicalCribDischargeRepair[] = [];
  for (const duplicate of candidates.filter(isMalformedReportCopy)) {
    const parentBedId = resolveReportBedId(duplicate.bedId.replace(/^cuna\s+/i, ''));
    const keepers = candidates.filter(
      row =>
        row.id !== duplicate.id &&
        isCanonicalDeparture(row) &&
        row.clinicalEpisodeId === duplicate.clinicalEpisodeId &&
        row.bedId === parentBedId &&
        // The associated row used the mother's time; the report copy used the RN's own time.
        // Different times require proof of the same import, never a fuzzy minute tolerance.
        (row.time === duplicate.time || isSameImportBatch(row, duplicate)) &&
        row.status === duplicate.status &&
        normalizeRut(row.rut) === normalizeRut(duplicate.rut) &&
        (!duplicate.diagnosis?.trim() || duplicate.diagnosis.trim() === row.diagnosis?.trim())
    );
    if (keepers.length !== 1 || !duplicate.id || !keepers[0].id) continue;
    const kept = keepers[0];
    if (
      [kept.id, duplicate.id].some(
        id => record.discharges.filter(row => row.id === id).length !== 1
      )
    )
      continue;
    repairs.push({ kept: structuredClone(kept), duplicate: structuredClone(duplicate) });
  }
  return repairs;
};
