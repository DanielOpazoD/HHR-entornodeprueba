import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import { DischargeData, DischargeType } from '@/features/census/contracts/censusMovementContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import type { DischargeAddCommandPayload } from '@/features/census/domain/movements/contracts';
import {
  buildClearedBedPatient,
  clonePatientSnapshot,
  type MovementAuditEntry,
} from '@/features/census/controllers/patientMovementCreationSharedController';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

interface BuildDischargeEntriesParams {
  patient: PatientData;
  bedId: string;
  bedDef?: BedDefinition;
  payload: DischargeAddCommandPayload;
  resolvedMovementDate: string;
  createId: () => string;
}

export const buildDischargeEntries = ({
  patient,
  bedId,
  bedDef,
  payload,
  resolvedMovementDate,
  createId,
}: BuildDischargeEntriesParams): {
  discharges: DischargeData[];
  auditEntries: MovementAuditEntry[];
} => {
  const {
    status,
    cribStatus,
    type: dischargeType,
    typeOther: dischargeTypeOther,
    time,
    dischargeTarget: target = 'both',
  } = payload;
  const discharges: DischargeData[] = [];
  const auditEntries: MovementAuditEntry[] = [];

  if (target === 'mother' || target === 'both') {
    const patientWithEpisodeId = ensurePatientClinicalEpisodeId(patient);
    const movementId = createId();
    discharges.push({
      id: movementId,
      movementDate: resolvedMovementDate,
      admissionDate: patientWithEpisodeId.admissionDate,
      clinicalEpisodeId: patientWithEpisodeId.clinicalEpisodeId,
      bedName: bedDef?.name || bedId,
      bedId,
      bedType: bedDef?.type || '',
      patientName: patientWithEpisodeId.patientName,
      rut: patientWithEpisodeId.rut,
      diagnosis: patientWithEpisodeId.pathology,
      specialty: patientWithEpisodeId.specialty,
      time: time || '',
      status,
      dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
      dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
      age: patientWithEpisodeId.age,
      insurance: patientWithEpisodeId.insurance,
      origin: patientWithEpisodeId.origin,
      isRapanui: patientWithEpisodeId.isRapanui,
      originalData: clonePatientSnapshot(patientWithEpisodeId),
      isNested: false,
    });
    auditEntries.push({
      movementId,
      bedId,
      patientName: patient.patientName,
      rut: patient.rut,
      status,
      diagnosis: patientWithEpisodeId.pathology,
      movementDate: resolvedMovementDate,
      time: time || '',
      dischargeType: status === 'Vivo' ? dischargeType : undefined,
      dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
      clinicalEpisodeId: patientWithEpisodeId.clinicalEpisodeId,
    });
  }

  if ((target === 'baby' || target === 'both') && patient.clinicalCrib?.patientName && cribStatus) {
    const cribWithEpisodeId = ensurePatientClinicalEpisodeId(patient.clinicalCrib);
    const movementId = createId();
    discharges.push({
      id: movementId,
      movementDate: resolvedMovementDate,
      admissionDate: cribWithEpisodeId.admissionDate,
      clinicalEpisodeId: cribWithEpisodeId.clinicalEpisodeId,
      bedName: `${bedDef?.name || bedId} (Cuna)`,
      bedId,
      bedType: 'Cuna',
      patientName: cribWithEpisodeId.patientName,
      rut: cribWithEpisodeId.rut,
      diagnosis: cribWithEpisodeId.pathology,
      specialty: cribWithEpisodeId.specialty,
      time: time || '',
      status: cribStatus,
      age: cribWithEpisodeId.age,
      insurance: patient.insurance,
      origin: patient.origin,
      isRapanui: patient.isRapanui,
      originalData: clonePatientSnapshot(cribWithEpisodeId),
      isNested: true,
    });
    auditEntries.push({
      movementId,
      bedId,
      patientName: patient.clinicalCrib.patientName,
      rut: patient.clinicalCrib.rut,
      status: cribStatus,
      diagnosis: cribWithEpisodeId.pathology,
      movementDate: resolvedMovementDate,
      time: time || '',
      dischargeType: cribStatus === 'Vivo' ? dischargeType : undefined,
      dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
      clinicalEpisodeId: cribWithEpisodeId.clinicalEpisodeId,
    });
  }

  return {
    discharges,
    auditEntries,
  };
};

interface ResolveDischargeUpdatedBedParams {
  patient: PatientData;
  bedId: string;
  target?: DischargeAddCommandPayload['dischargeTarget'];
  createEmptyPatient: (bedId: string) => PatientData;
}

export const resolveDischargeUpdatedBed = ({
  patient,
  bedId,
  target = 'both',
  createEmptyPatient,
}: ResolveDischargeUpdatedBedParams): PatientData => {
  if (target === 'both') {
    return buildClearedBedPatient({
      bedId,
      location: patient.location,
      createEmptyPatient,
    });
  }

  if (target === 'mother') {
    if (patient.clinicalCrib?.patientName) {
      return {
        ...createEmptyPatient(bedId),
        ...patient.clinicalCrib,
        location: patient.location,
        bedMode: 'Cuna',
        clinicalCrib: undefined,
        hasCompanionCrib: false,
      };
    }

    return buildClearedBedPatient({
      bedId,
      location: patient.location,
      createEmptyPatient,
    });
  }

  return {
    ...patient,
    clinicalCrib: undefined,
  };
};
