import { normalizeRut } from '@/utils/rutUtils';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff, ConflictEntry } from '../contracts/censusImportDiff';

export const previousCensusDate = (day: string): string => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

type Subject = {
  clinicalEpisodeId?: string;
  rut?: string;
  patientName?: string;
  admissionDate?: string;
  admissionTime?: string;
  scope: 'principal' | 'crib';
};

const occupants = (record: DailyRecord): Subject[] =>
  Object.values(record.beds).flatMap(patient => [
    ...(patient.patientName?.trim() ? [{ ...patient, scope: 'principal' as const }] : []),
    ...(patient.clinicalCrib?.patientName?.trim()
      ? [{ ...patient.clinicalCrib, scope: 'crib' as const }]
      : []),
  ]);

const legacyKey = (subject: Subject): string => {
  const run = normalizeRut(subject.rut);
  const name = subject.patientName?.trim().replace(/\s+/g, ' ').toLocaleUpperCase();
  return run && name && subject.admissionDate && subject.admissionTime
    ? [subject.scope, run, name, subject.admissionDate, subject.admissionTime].join('|')
    : '';
};
const identityKey = (subject: Subject): string =>
  subject.clinicalEpisodeId?.trim() || legacyKey(subject);

// An identified episode never falls back to RUN. Legacy ID enrichment needs an unambiguous,
// full admission identity and principal/crib scope; a mother's RUN cannot explain her newborn.
const isExplained = (subject: Subject, previous: Subject[], explained: Subject[]): boolean => {
  const episode = subject.clinicalEpisodeId?.trim();
  if (episode) return explained.some(other => other.clinicalEpisodeId?.trim() === episode);
  const key = legacyKey(subject);
  if (!key || previous.filter(other => legacyKey(other) === key).length !== 1) return false;
  const matches = explained.filter(other => legacyKey(other) === key);
  return new Set(matches.map(identityKey)).size === 1;
};

const recordedSubjects = (record: DailyRecord): Subject[] =>
  [...record.discharges, ...record.transfers, ...record.cma]
    .filter(movement => !movement.deletedAt)
    .map(movement => ({
      ...movement,
      scope: 'isNested' in movement && movement.isNested ? 'crib' : 'principal',
      clinicalEpisodeId: movement.clinicalEpisodeId ?? movement.originalData?.clinicalEpisodeId,
      admissionDate:
        ('admissionDate' in movement ? movement.admissionDate : undefined) ??
        movement.originalData?.admissionDate,
      admissionTime: movement.originalData?.admissionTime,
    }));

const plannedPatient = (patient: PatientData): Subject => ({ ...patient, scope: 'principal' });

/** Absence is a review requirement, NEVER evidence authorizing an administrative discharge. */
export const previousCensusContinuityConflicts = (
  previous: DailyRecord,
  current: DailyRecord,
  diff: CensusImportDiff
): ConflictEntry[] => {
  const prior = occupants(previous);
  const explained: Subject[] = [
    ...occupants(current),
    ...recordedSubjects(previous),
    ...recordedSubjects(current),
    ...diff.admissions.map(entry => plannedPatient(entry.patient)),
    ...diff.updates.map(entry => plannedPatient(entry.patient)),
    ...(diff.activeClinicalCribs ?? []).map(entry => ({
      ...entry.patient,
      scope: 'crib' as const,
    })),
    ...diff.discharges.flatMap(entry => [
      {
        clinicalEpisodeId: entry.encounterId ?? entry.source?.encounterId,
        rut: entry.rut,
        patientName: entry.patientName,
        scope: 'principal' as const,
        admissionDate: entry.expectedOccupant?.admissionDate,
        admissionTime: entry.expectedOccupant?.admissionTime,
      },
      ...(entry.associatedClinicalCrib
        ? [{ ...entry.associatedClinicalCrib, scope: 'crib' as const }]
        : []),
    ]),
    ...(diff.reportEgresos ?? []).map(entry => ({
      clinicalEpisodeId: entry.encounterId,
      rut: entry.run,
      patientName: entry.patientName,
      admissionDate: entry.admissionDay,
      admissionTime: entry.admissionTime,
      scope: entry.fromClinicalCrib ? ('crib' as const) : ('principal' as const),
    })),
  ];
  return prior.flatMap((patient, index) => {
    if (isExplained(patient, prior, explained)) return [];
    return [
      {
        // Yesterday's bed may now belong to somebody else: do not isolate to that bed.
        bedId: null,
        code: 'previous-census-continuity' as const,
        continuityKey: `${previous.date}|${identityKey(patient)}|${patient.scope}|${patient.clinicalEpisodeId ? '' : index}`,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: `El paciente figuraba en el censo del ${previous.date}, pero no tiene continuidad ni un alta, traslado o salida registrada para ese episodio. Se requiere verificar su salida en Gestión de Camas; la ausencia no autoriza un egreso.`,
      },
    ];
  });
};
