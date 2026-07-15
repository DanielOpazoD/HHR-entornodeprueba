import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import { TransferData } from '@/features/census/contracts/censusMovementContracts';
import type { TransferCommandPayload } from '@/features/census/domain/movements/contracts';
import {
  buildClearedBedPatient,
  clonePatientSnapshot,
} from '@/features/census/controllers/patientMovementCreationSharedController';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import {
  buildMovementProvenance,
  type MovementProvenanceSeed,
} from '@/application/census/movementProvenancePolicy';

interface BuildTransferEntriesParams {
  patient: PatientData;
  bedId: string;
  bedDef?: BedDefinition;
  payload: TransferCommandPayload;
  resolvedMovementDate: string;
  createId: () => string;
  provenance?: MovementProvenanceSeed;
}

export const buildTransferEntries = ({
  patient,
  bedId,
  bedDef,
  payload,
  resolvedMovementDate,
  createId,
  provenance,
}: BuildTransferEntriesParams): TransferData[] => {
  const {
    evacuationMethod: method,
    receivingCenter: center,
    receivingCenterOther: centerOther,
    transferEscort: escort,
    time,
  } = payload;
  const patientWithEpisodeId = ensurePatientClinicalEpisodeId(patient);

  const primaryMovementId = createId();
  const transfers: TransferData[] = [
    {
      id: primaryMovementId,
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
      evacuationMethod: method,
      receivingCenter: center,
      receivingCenterOther: centerOther,
      transferEscort: escort,
      age: patientWithEpisodeId.age,
      insurance: patientWithEpisodeId.insurance,
      origin: patientWithEpisodeId.origin,
      isRapanui: patientWithEpisodeId.isRapanui,
      originalData: clonePatientSnapshot(patientWithEpisodeId),
      isNested: false,
      movementProvenance: provenance
        ? buildMovementProvenance({ movementId: primaryMovementId, ...provenance })
        : undefined,
    },
  ];

  if (patient.clinicalCrib?.patientName) {
    const cribWithEpisodeId = ensurePatientClinicalEpisodeId(patient.clinicalCrib);
    const cribMovementId = createId();
    transfers.push({
      id: cribMovementId,
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
      evacuationMethod: method,
      receivingCenter: center,
      receivingCenterOther: centerOther,
      transferEscort: escort,
      age: cribWithEpisodeId.age,
      insurance: patient.insurance,
      origin: patient.origin,
      isRapanui: patient.isRapanui,
      originalData: clonePatientSnapshot(cribWithEpisodeId),
      isNested: true,
      movementProvenance: provenance
        ? buildMovementProvenance({ movementId: cribMovementId, ...provenance })
        : undefined,
    });
  }

  return transfers;
};

export const resolveTransferUpdatedBed = ({
  bedId,
  patient,
  createEmptyPatient,
}: {
  bedId: string;
  patient: PatientData;
  createEmptyPatient: (bedId: string) => PatientData;
}): PatientData =>
  buildClearedBedPatient({
    bedId,
    location: patient.location,
    createEmptyPatient,
  });
