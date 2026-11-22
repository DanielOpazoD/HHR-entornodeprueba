/**
 * @module patientAnalysisEngine
 * @description Internal processing functions for the patient analysis pipeline.
 * Handles admission tracking, discharge processing, transfer events,
 * conflict detection, and census reconciliation.
 *
 * These are pure functions (no side effects) that operate on the AnalysisAccumulator.
 * Extracted from patientAnalysisSupport.ts for readability and testability.
 */

import type {
  PatientAnalysisPatientContract,
  PatientAnalysisRecordContract,
} from '@/features/admin/patient-flow/patientAnalysisContracts';
import type { MasterPatient } from '@/types/domain/patientMaster';
import { formatRut, isValidRut } from '@/utils/rutUtils';

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

export interface Conflict {
  rut: string;
  description: string;
  options: string[];
  records: string[];
  bedMap: Record<string, string>;
}

export interface ActivePatientEvent {
  startDate: string;
  lastSeen: string;
  bedId: string;
  diagnosis: string;
}

export interface AnalysisAccumulator {
  patientsMap: Map<string, MasterPatient>;
  conflicts: Conflict[];
  activeEvents: Map<string, ActivePatientEvent>;
}

/** A present patient with required rut and name (narrowed from optional contract). */
type PatientAnalysisPresentPatient = PatientAnalysisPatientContract & {
  rut: string;
  patientName: string;
};

export type PatientAnalysisOccupiedBedEntry = [string, PatientAnalysisPresentPatient];

/* ------------------------------------------------------------------ */
/*  Pure utilities                                                     */
/* ------------------------------------------------------------------ */

export const normalizeAnalysisRut = (rut: string): string => formatRut(rut).toUpperCase();

export const isPatientAnalysisOccupiedBedEntry = (
  entry: [string, PatientAnalysisPatientContract | undefined]
): entry is PatientAnalysisOccupiedBedEntry => {
  const patient = entry[1];
  return Boolean(patient?.rut && isValidRut(patient.rut) && patient.patientName?.trim());
};

export const createAnalysisAccumulator = (): AnalysisAccumulator => ({
  patientsMap: new Map<string, MasterPatient>(),
  conflicts: [],
  activeEvents: new Map<string, ActivePatientEvent>(),
});

/* ------------------------------------------------------------------ */
/*  Processing functions                                               */
/* ------------------------------------------------------------------ */

/** Create or retrieve a master patient record in the accumulator. */
export const ensureMasterPatient = (
  accumulator: AnalysisAccumulator,
  normalizedRut: string,
  patient: PatientAnalysisPresentPatient,
  date: string,
  now: number
): MasterPatient => {
  const existing = accumulator.patientsMap.get(normalizedRut);
  if (existing) return existing;

  const created: MasterPatient = {
    rut: normalizedRut,
    fullName: patient.patientName,
    birthDate: patient.birthDate,
    forecast: patient.insurance,
    gender: patient.biologicalSex,
    hospitalizations: [],
    vitalStatus: 'Vivo',
    lastAdmission: patient.admissionDate || date,
    createdAt: now,
    updatedAt: now,
  };
  accumulator.patientsMap.set(normalizedRut, created);
  return created;
};

/** Detect and record name discrepancies for the same RUT. */
export const registerNameConflict = (
  conflicts: Conflict[],
  normalizedRut: string,
  currentName: string,
  nextName: string,
  date: string,
  bedId: string
) => {
  if (currentName.trim().toLowerCase() === nextName.trim().toLowerCase()) return;

  const existing = conflicts.find(c => c.rut === normalizedRut);
  if (!existing) {
    conflicts.push({
      rut: normalizedRut,
      description: 'Diferencia de nombres detectada',
      options: Array.from(new Set([currentName, nextName])),
      records: [date],
      bedMap: { [date]: bedId },
    });
    return;
  }

  if (!existing.records.includes(date)) existing.records.push(date);
  if (!existing.options.includes(nextName)) existing.options.push(nextName);
  existing.bedMap[date] = bedId;
};

/** Process a patient admission presence in a census bed. */
export const registerAdmissionPresence = ({
  accumulator,
  date,
  bedId,
  patient,
  now,
}: {
  accumulator: AnalysisAccumulator;
  date: string;
  bedId: string;
  patient: PatientAnalysisPresentPatient;
  now: number;
}) => {
  const normalizedRut = normalizeAnalysisRut(patient.rut);
  const master = ensureMasterPatient(accumulator, normalizedRut, patient, date, now);

  registerNameConflict(
    accumulator.conflicts,
    normalizedRut,
    master.fullName,
    patient.patientName,
    date,
    bedId
  );

  const active = accumulator.activeEvents.get(normalizedRut);
  if (!active) {
    accumulator.activeEvents.set(normalizedRut, {
      startDate: patient.admissionDate || date,
      lastSeen: date,
      bedId,
      diagnosis: patient.pathology || 'Ingreso detected by presence',
    });
    master.hospitalizations?.push({
      id: `${date}-ingreso-auto`,
      type: 'Ingreso',
      date: patient.admissionDate || date,
      diagnosis: patient.pathology || 'Ingreso detectado',
      bedName: bedId,
    });
    master.lastAdmission = patient.admissionDate || date;
    return normalizedRut;
  }

  active.lastSeen = date;
  return normalizedRut;
};

/** Process a patient discharge event. */
export const registerDischargeEvent = (
  accumulator: AnalysisAccumulator,
  date: string,
  discharge: NonNullable<PatientAnalysisRecordContract['discharges']>[number],
  now: number = Date.now()
) => {
  if (!discharge.rut || !isValidRut(discharge.rut)) return;

  const normalizedRut = normalizeAnalysisRut(discharge.rut);
  let master = accumulator.patientsMap.get(normalizedRut);

  // Create patient + admission if not yet indexed (same-day discharge edge case)
  if (!master) {
    master = ensureMasterPatient(
      accumulator,
      normalizedRut,
      {
        rut: discharge.rut,
        patientName: discharge.patientName,
        admissionDate: discharge.admissionDate || date,
        birthDate: undefined,
        insurance: discharge.insurance,
        biologicalSex: undefined,
        pathology: discharge.diagnosis,
      },
      date,
      now
    );
    master.hospitalizations?.push({
      id: `${discharge.admissionDate || date}-ingreso-auto`,
      type: 'Ingreso',
      date: discharge.admissionDate || date,
      diagnosis: discharge.diagnosis || 'Ingreso detectado desde egreso',
      bedName: discharge.bedName,
    });
    master.lastAdmission = discharge.admissionDate || date;
  }

  master.hospitalizations?.push({
    id: `${date}-egreso`,
    type: 'Egreso',
    date,
    diagnosis: discharge.diagnosis || 'S/D',
    bedName: discharge.bedName,
  });
  master.lastDischarge = date;

  if (discharge.status === 'Fallecido') {
    master.vitalStatus = 'Fallecido';
    master.hospitalizations?.push({
      id: `${date}-defuncion`,
      type: 'Fallecimiento',
      date,
      diagnosis: discharge.diagnosis,
    });
  }

  accumulator.activeEvents.delete(normalizedRut);
};

/** Process a patient transfer event. */
export const registerTransferEvent = (
  accumulator: AnalysisAccumulator,
  date: string,
  transfer: NonNullable<PatientAnalysisRecordContract['transfers']>[number],
  now: number = Date.now()
) => {
  if (!transfer.rut || !isValidRut(transfer.rut)) return;

  const normalizedRut = normalizeAnalysisRut(transfer.rut);
  let master = accumulator.patientsMap.get(normalizedRut);

  // Create patient + admission if not yet indexed (same-day transfer edge case)
  if (!master) {
    master = ensureMasterPatient(
      accumulator,
      normalizedRut,
      {
        rut: transfer.rut,
        patientName: transfer.patientName,
        admissionDate: transfer.admissionDate || date,
        birthDate: undefined,
        insurance: undefined,
        biologicalSex: undefined,
        pathology: transfer.diagnosis,
      },
      date,
      now
    );
    master.hospitalizations?.push({
      id: `${transfer.admissionDate || date}-ingreso-auto`,
      type: 'Ingreso',
      date: transfer.admissionDate || date,
      diagnosis: transfer.diagnosis || 'Ingreso detectado desde traslado',
      bedName: transfer.bedName,
    });
    master.lastAdmission = transfer.admissionDate || date;
  }

  master.hospitalizations?.push({
    id: `${date}-traslado`,
    type: 'Traslado',
    date,
    diagnosis: transfer.diagnosis || 'S/D',
    bedName: transfer.bedName,
    receivingCenter: transfer.receivingCenter,
  });
  accumulator.activeEvents.delete(normalizedRut);
};

/** Auto-discharge patients not found in today's census. */
export const closePatientsMissingFromCensus = (
  accumulator: AnalysisAccumulator,
  rutsInCensusToday: Set<string>
) => {
  for (const [rut, active] of Array.from(accumulator.activeEvents.entries())) {
    if (rutsInCensusToday.has(rut)) continue;

    const master = accumulator.patientsMap.get(rut);
    if (master) {
      master.hospitalizations?.push({
        id: `${active.lastSeen}-egreso-auto`,
        type: 'Egreso',
        date: active.lastSeen,
        diagnosis: active.diagnosis || 'Salida automática (no detectado en censo)',
        bedName: active.bedId,
      });
      master.lastDischarge = active.lastSeen;
    }

    accumulator.activeEvents.delete(rut);
  }
};
