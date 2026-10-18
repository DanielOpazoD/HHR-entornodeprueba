import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import {
  resolveCmaHistoricalAdmissionDate,
  type CMAData,
  type DischargeData,
  type TransferData,
} from '@/types/domain/movements';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

type MovementRecord = Pick<
  DischargeData | TransferData,
  'bedId' | 'patientName' | 'rut' | 'admissionDate' | 'clinicalEpisodeId' | 'isNested'
>;

type CmaMovementRecord = CMAData;

type ConfirmedMovementRecord = MovementRecord | CmaMovementRecord;

const normalizeIdentity = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const hasActivePatientIdentity = (patient: PatientData | undefined): boolean =>
  Boolean(normalizeIdentity(patient?.patientName) || normalizeIdentity(patient?.rut));

const hasResidualClinicalState = (patient: PatientData | undefined): boolean =>
  (
    [
      'pathology',
      'admissionDate',
      'clinicalEpisodeId',
      'handoffNoteDayShift',
      'handoffNoteNightShift',
      'medicalHandoffNote',
      'deliveryRoute',
      'deliveryDate',
      'surgicalComplication',
    ] as const
  ).some(field => normalizeIdentity(patient?.[field])) ||
  [patient?.upcChecklist, patient?.cudyr, patient?.medicalHandoffAudit].some(Boolean) ||
  (['devices', 'deviceInstanceHistory', 'clinicalEvents', 'medicalHandoffEntries'] as const).some(
    field => (patient?.[field] || []).length > 0
  ) ||
  Object.keys(patient?.deviceDetails || {}).length > 0;

const isCmaMovement = (movement: ConfirmedMovementRecord): movement is CmaMovementRecord =>
  !('bedId' in movement);

const resolveMovementAdmissionDate = (movement: ConfirmedMovementRecord): string => {
  if (isCmaMovement(movement)) {
    return resolveCmaHistoricalAdmissionDate(movement);
  }
  return movement.admissionDate || '';
};

const matchesMovementPatient = (
  patient: PatientData | undefined,
  movement: ConfirmedMovementRecord
): boolean => {
  if (!hasActivePatientIdentity(patient)) {
    return false;
  }

  const patientEpisodeId = normalizeIdentity(patient?.clinicalEpisodeId);
  const movementEpisodeId = normalizeIdentity(movement.clinicalEpisodeId);
  if (patientEpisodeId && movementEpisodeId && patientEpisodeId !== movementEpisodeId) {
    return false;
  }

  const patientRut = normalizeIdentity(patient?.rut);
  const movementRut = normalizeIdentity(movement.rut);
  const hasBothDocuments = Boolean(patientRut && movementRut);
  const left = hasBothDocuments ? patientRut : normalizeIdentity(patient?.patientName);
  const right = hasBothDocuments ? movementRut : normalizeIdentity(movement.patientName);
  if (!left || !right || left !== right) return false;

  const patientAdmissionDate = normalizeIdentity(patient?.admissionDate);
  const movementAdmissionDate = normalizeIdentity(resolveMovementAdmissionDate(movement));
  if (!hasBothDocuments && isCmaMovement(movement)) {
    return Boolean(
      patientAdmissionDate &&
      movementAdmissionDate &&
      patientAdmissionDate === movementAdmissionDate
    );
  }
  return (
    !patientAdmissionDate ||
    !movementAdmissionDate ||
    patientAdmissionDate === movementAdmissionDate
  );
};

const resolveMovementBedId = (movement: ConfirmedMovementRecord): string => {
  if ('bedId' in movement) {
    return movement.bedId;
  }
  return movement.originalBedId || movement.bedName;
};

const isNestedMovement = (movement: ConfirmedMovementRecord): boolean =>
  'isNested' in movement && Boolean(movement.isNested);

const collectConfirmedMovementsByBed = (
  record: DailyRecord
): Map<string, ConfirmedMovementRecord[]> => {
  const byBed = new Map<string, ConfirmedMovementRecord[]>();
  const append = (movement: ConfirmedMovementRecord) => {
    const bedId = resolveMovementBedId(movement);
    if (!normalizeIdentity(bedId)) return;
    const entries = byBed.get(bedId) ?? [];
    entries.push(movement);
    byBed.set(bedId, entries);
  };

  getActiveDischarges(record.discharges).forEach(append);
  getActiveTransfers(record.transfers).forEach(append);
  getActiveCma(record.cma).forEach(append);
  return byBed;
};

export const normalizeMovementBedConsistency = (
  record: DailyRecord
): { record: DailyRecord; patches: Record<string, PatientData | undefined> } => {
  const movementsByBed = collectConfirmedMovementsByBed(record);
  if (movementsByBed.size === 0) {
    return { record, patches: {} };
  }

  const beds = { ...record.beds };
  const patches: Record<string, PatientData | undefined> = {};

  movementsByBed.forEach((movements, bedId) => {
    const currentBed = beds[bedId];
    if (!currentBed) {
      return;
    }

    const clearPrincipal =
      (!hasActivePatientIdentity(currentBed) && hasResidualClinicalState(currentBed)) ||
      movements.some(
        movement => !isNestedMovement(movement) && matchesMovementPatient(currentBed, movement)
      );
    const cribClosed = movements.some(
      movement =>
        isNestedMovement(movement) && matchesMovementPatient(currentBed.clinicalCrib, movement)
    );
    if (!clearPrincipal && !cribClosed) return;

    const updatedBed = clearPrincipal
      ? { ...createEmptyPatient(bedId), location: currentBed.location }
      : { ...currentBed, clinicalCrib: undefined, hasCompanionCrib: false };
    if (clearPrincipal && !cribClosed && hasActivePatientIdentity(currentBed.clinicalCrib)) {
      updatedBed.clinicalCrib = currentBed.clinicalCrib;
      updatedBed.hasCompanionCrib = true;
    }
    beds[bedId] = updatedBed;
    patches[`beds.${bedId}`] = updatedBed;
  });

  return {
    record: Object.keys(patches).length ? { ...record, beds } : record,
    patches,
  };
};
