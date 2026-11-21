import type { PatientData } from '@/types/domain/patient';

import { BedDefinition } from '@/types/domain/beds';

import { TransferData } from '@/types/domain/movements';
import type { TransferCommandPayload } from '@/types/movements';
import { buildClearedBedPatient } from '@/features/census/controllers/patientMovementCreationSharedController';
import type { MovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';
import { buildMovementRow } from '@/application/census/movementRowBuilder';

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
  const stamp = { movementDate: resolvedMovementDate, time: time || '' };
  const crib = patient.clinicalCrib?.patientName ? patient.clinicalCrib : undefined;
  const transferRow = (person: PatientData, isNested: boolean): TransferData => ({
    ...buildMovementRow({
      id: createId(),
      patient: person,
      bedId,
      bedDef,
      stamp,
      isNested,
      provenance,
    }),
    evacuationMethod: method,
    receivingCenter: center,
    receivingCenterOther: centerOther,
    transferEscort: escort,
  });

  // The newborn travels in its own reversible row, so the mother's snapshot leaves the crib out.
  const transfers = [transferRow(crib ? { ...patient, clinicalCrib: undefined } : patient, false)];
  if (crib) transfers.push(transferRow(crib, true));

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
