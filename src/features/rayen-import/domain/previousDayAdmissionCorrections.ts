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
  return [...subjectsByDay.entries()].map(([day, subjects]) => {
    const record = records.get(day);
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
    };
  });
};

export const applyHistoricalAdmissions = (
  record: DailyRecord,
  subjects: HistoricalAdmissionSubject[]
): { record: DailyRecord; applied: number } => {
  const beds = { ...record.beds };
  let applied = 0;
  const ordered = [...subjects].sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === 'principal' ? -1 : 1
  );
  for (const subject of ordered) {
    const current = { ...record, beds };
    if (recordHasSubject(current, subject)) continue;
    if (subject.kind === 'principal') {
      if (isOccupied(beds[subject.bedId])) {
        throw new Error(
          `No se aplicó el ingreso histórico de ${subject.patient.patientName}: ${subject.bedId} está ocupada por otro paciente.`
        );
      }
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
      throw new Error(
        `No se aplicó la cuna histórica de ${subject.patient.patientName}: la madre no está en el censo de ese día.`
      );
    }
    const [bedId, principal] = principalBed;
    if (!mapRayenBed({ clinicalCribParentBedId: bedId }).isClinicalCrib) {
      throw new Error(
        `No se aplicó la cuna histórica de ${subject.patient.patientName}: ${bedId} no admite una cuna RN.`
      );
    }
    if (principal.clinicalCrib && !samePatient(principal.clinicalCrib, subject.patient)) {
      throw new Error(
        `No se aplicó la cuna histórica de ${subject.patient.patientName}: ${bedId} ya conserva otro recién nacido.`
      );
    }
    beds[bedId] = {
      ...principal,
      clinicalCrib: { ...subject.patient, bedId },
    };
    applied += 1;
  }
  return {
    record: applied > 0 ? { ...record, beds, lastUpdated: new Date().toISOString() } : record,
    applied,
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
