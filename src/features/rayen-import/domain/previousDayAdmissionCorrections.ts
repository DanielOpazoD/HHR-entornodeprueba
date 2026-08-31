import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type {
  AdmissionEntry,
  CensusImportDiff,
  PreviousDayEdit,
} from '../contracts/censusImportDiff';
import { isOccupied } from './applyCensusImportDiff';
import { clinicalAdmissionDay } from './censusDayPolicy';
import { mapRayenBed } from '../mapping/bedMapping';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
export type HistoricalAdmissionSubject = {
  day: string;
  kind: 'principal' | 'clinical-crib';
  bedId: string;
  patient: PatientData;
  principal: PatientData;
};
export const patientAdmissionDay = (patient: PatientData): string => {
  const day = patient.admissionDate?.trim();
  const time = patient.admissionTime?.trim().slice(0, 5);
  if (!day || !time) return '';
  return resolveClinicalDayForDateTime(day, time) ?? day;
};
export const isPreviousNightRollover = (admission: AdmissionEntry, censusDay: string): boolean => {
  if (!admission.source) return false;
  const wallClock = encounterWallClockInRapaNui(admission.source.admissionDatetime);
  return Boolean(
    wallClock &&
    wallClock.slice(0, 10) === censusDay &&
    clinicalAdmissionDay(admission.source) < censusDay
  );
};
export const isPatientPreviousNightRollover = (
  patient: PatientData,
  censusDay: string
): boolean => {
  const admissionDay = patientAdmissionDay(patient);
  return Boolean(
    admissionDay && patient.admissionDate?.trim() === censusDay && admissionDay < censusDay
  );
};

const admissionSubjects = (
  admission: AdmissionEntry,
  censusDay: string
): HistoricalAdmissionSubject[] => {
  if (admission.isCma) return [];
  const principalDay = admission.source ? clinicalAdmissionDay(admission.source) : '';
  const historicalBedId = admission.source?.verifiedBedPlacement?.bedId;
  const principalRollover = isPreviousNightRollover(admission, censusDay);
  const subjects: HistoricalAdmissionSubject[] =
    principalRollover && principalDay && historicalBedId
      ? [
          {
            day: principalDay,
            kind: 'principal',
            bedId: historicalBedId,
            patient: admission.patient,
            principal: admission.patient,
          },
        ]
      : [];
  const crib = admission.patient.clinicalCrib;
  const cribDay = crib ? patientAdmissionDay(crib) : '';
  const supportsClinicalCrib = historicalBedId
    ? mapRayenBed({ clinicalCribParentBedId: historicalBedId }).isClinicalCrib
    : false;
  if (
    crib &&
    cribDay &&
    cribDay < censusDay &&
    isPatientPreviousNightRollover(crib, censusDay) &&
    historicalBedId &&
    supportsClinicalCrib
  ) {
    subjects.push({
      day: cribDay,
      kind: 'clinical-crib',
      bedId: historicalBedId,
      patient: crib,
      principal: admission.patient,
    });
  }
  return subjects;
};

const historicalAdmissionCandidates = (diff: CensusImportDiff): AdmissionEntry[] => [
  ...diff.admissions,
  ...(diff.previousDayAdmissionCandidates ?? []),
];

const samePatient = (candidate: PatientData | undefined, expected: PatientData): boolean => {
  if (!candidate) return false;
  const episodeId = expected.clinicalEpisodeId?.trim();
  if (episodeId && candidate.clinicalEpisodeId) {
    return candidate.clinicalEpisodeId === episodeId;
  }
  const rut = normalizeRut(expected.rut);
  return !!rut && normalizeRut(candidate.rut) === rut;
};

const recordHasSubject = (
  record: DailyRecord | null | undefined,
  subject: HistoricalAdmissionSubject
): boolean => {
  if (!record) return false;
  return Object.values(record.beds).some(patient =>
    subject.kind === 'principal'
      ? samePatient(patient, subject.patient)
      : samePatient(patient.clinicalCrib, subject.patient)
  );
};

const subjectKey = (
  subject: Pick<HistoricalAdmissionSubject, 'kind' | 'bedId' | 'patient'>
): string =>
  [
    subject.kind,
    subject.bedId,
    subject.patient.clinicalEpisodeId?.trim() || normalizeRut(subject.patient.rut),
  ].join(':');

export const previousDayAdmissionDays = (diff: CensusImportDiff, censusDay: string): string[] =>
  historicalAdmissionCandidates(diff)
    .flatMap(entry => admissionSubjects(entry, censusDay).map(subject => subject.day))
    .filter(day => day < censusDay);

/**
 * Una condición de dominio que hace inaplicable un ingreso histórico (la cama
 * del día previo sigue ocupada por otro paciente, la madre no está ese día,
 * la cama no admite cuna, la cuna ya tiene otro RN). Se detecta en la
 * PLANIFICACIÓN para mostrarse como omisión en la revisión — antes se
 * descubría recién al escribir, post-commit, y dejaba la corrida marcada
 * «requiere una nueva captura» para siempre (ninguna captura la arregla).
 */
const resolveHistoricalAdmissionBlock = (
  record: DailyRecord | null | undefined,
  subject: HistoricalAdmissionSubject
): string | null => {
  if (!record) return null;
  if (subject.kind === 'principal') {
    const occupant = record.beds[subject.bedId];
    return isOccupied(occupant) && !samePatient(occupant, subject.patient)
      ? `${subject.bedId} está ocupada ese día por ${occupant.patientName}`
      : null;
  }
  const principalBed = Object.entries(record.beds).find(([, patient]) =>
    samePatient(patient, subject.principal)
  );
  if (!principalBed) return 'la madre no está en el censo de ese día';
  const [bedId, principal] = principalBed;
  if (!mapRayenBed({ clinicalCribParentBedId: bedId }).isClinicalCrib) {
    return `${bedId} no admite una cuna RN`;
  }
  if (principal.clinicalCrib && !samePatient(principal.clinicalCrib, subject.patient)) {
    return `${bedId} ya conserva otro recién nacido`;
  }
  return null;
};

export const planPreviousDayAdmissionEdits = (
  diff: CensusImportDiff,
  censusDay: string,
  records: ReadonlyMap<string, DailyRecord | null>,
  isAdmin: boolean,
  canWrite: (day: string, isAdmin: boolean) => boolean
): PreviousDayEdit[] => {
  const subjectsByDay = new Map<string, HistoricalAdmissionSubject[]>();
  for (const admission of historicalAdmissionCandidates(diff)) {
    for (const subject of admissionSubjects(admission, censusDay)) {
      if (
        !subject.day ||
        subject.day >= censusDay ||
        recordHasSubject(records.get(subject.day), subject)
      ) {
        continue;
      }
      const subjects = subjectsByDay.get(subject.day) ?? [];
      subjects.push(subject);
      subjectsByDay.set(subject.day, subjects);
    }
  }
  return [...subjectsByDay.keys()].sort().map(day => {
    const candidates = subjectsByDay.get(day) ?? [];
    const record = records.get(day);
    // La MISMA aplicación (pura) que usará la escritura decide qué sujetos son
    // aplicables y cuáles se omiten con motivo — así una cuna cuya madre llega
    // en esta misma corrección no queda bloqueada por evaluar el registro sin
    // simular el orden.
    const simulation = record ? applyHistoricalAdmissions(record, candidates) : null;
    const subjects = simulation
      ? candidates.filter(subject => recordHasSubject(simulation.record, subject))
      : candidates;
    const omitted = simulation?.omitted ?? [];
    return {
      day,
      reason: 'admission-night-shift-correction',
      patientNames: subjects.map(subject => subject.patient.patientName),
      recordExists: !!record,
      withinEditingWindow: canWrite(day, isAdmin),
      isSigned: Boolean(
        (record as { medicalSignature?: unknown } | null | undefined)?.medicalSignature
      ),
      admissionSubjects: subjects.map(subject => ({
        kind: subject.kind,
        bedId: subject.bedId,
        clinicalEpisodeId: subject.patient.clinicalEpisodeId,
        rut: subject.patient.rut,
      })),
      ...(omitted.length > 0 ? { omittedAdmissions: omitted } : {}),
    };
  });
};

export interface OmittedHistoricalAdmission {
  patientName: string;
  reason: string;
}

/**
 * Aplica los ingresos históricos aplicables y OMITE (con motivo) los que una
 * condición de dominio hace inaplicables, en vez de lanzar: un error duro aquí
 * corre post-commit del día actual y condenaba la corrida a «requiere una
 * nueva captura» permanente. Las omisiones ya se anticipan en la planificación
 * (resolveHistoricalAdmissionBlock); este camino cubre además la carrera en
 * que el día previo cambió entre la revisión y el commit.
 */
export const applyHistoricalAdmissions = (
  record: DailyRecord,
  subjects: HistoricalAdmissionSubject[]
): { record: DailyRecord; applied: number; omitted: OmittedHistoricalAdmission[] } => {
  const beds = { ...record.beds };
  let applied = 0;
  const omitted: OmittedHistoricalAdmission[] = [];
  const ordered = [...subjects].sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === 'principal' ? -1 : 1
  );
  for (const subject of ordered) {
    const current = { ...record, beds };
    if (recordHasSubject(current, subject)) continue;
    const block = resolveHistoricalAdmissionBlock(current, subject);
    if (block) {
      omitted.push({ patientName: subject.patient.patientName, reason: block });
      continue;
    }
    if (subject.kind === 'principal') {
      beds[subject.bedId] = {
        ...subject.patient,
        bedId: subject.bedId,
        clinicalCrib: undefined,
      };
      applied += 1;
      continue;
    }
    const principalBed = Object.entries(beds).find(([, patient]) =>
      samePatient(patient, subject.principal)
    );
    if (!principalBed) {
      omitted.push({
        patientName: subject.patient.patientName,
        reason: 'la madre no está en el censo de ese día',
      });
      continue;
    }
    const [bedId, principal] = principalBed;
    beds[bedId] = {
      ...principal,
      clinicalCrib: { ...subject.patient, bedId },
    };
    applied += 1;
  }
  return {
    record: applied > 0 ? { ...record, beds, lastUpdated: new Date().toISOString() } : record,
    applied,
    omitted,
  };
};

export const confirmedPreviousDayAdmissionsByDay = (
  diff: CensusImportDiff,
  censusDay: string,
  isAdmin: boolean,
  canWrite: (day: string, isAdmin: boolean) => boolean
): Map<string, HistoricalAdmissionSubject[]> => {
  const confirmedKeys = new Set(
    (diff.previousDayEdits ?? [])
      .filter(
        edit =>
          edit.reason === 'admission-night-shift-correction' &&
          edit.recordExists &&
          edit.withinEditingWindow &&
          !edit.isSigned
      )
      .flatMap(edit =>
        (edit.admissionSubjects ?? []).map(subject =>
          [
            edit.day,
            subject.kind,
            subject.bedId,
            subject.clinicalEpisodeId?.trim() || normalizeRut(subject.rut),
          ].join(':')
        )
      )
  );
  const byDay = new Map<string, HistoricalAdmissionSubject[]>();
  for (const admission of historicalAdmissionCandidates(diff)) {
    for (const subject of admissionSubjects(admission, censusDay)) {
      if (
        !subject.day ||
        subject.day >= censusDay ||
        !canWrite(subject.day, isAdmin) ||
        !confirmedKeys.has(`${subject.day}:${subjectKey(subject)}`)
      ) {
        continue;
      }
      const list = byDay.get(subject.day) ?? [];
      list.push(subject);
      byDay.set(subject.day, list);
    }
  }
  return byDay;
};
