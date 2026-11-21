import type { PatientData } from '@/types/domain/patient';

import { BedDefinition } from '@/types/domain/beds';

import { TransferData } from '@/types/domain/movements';
import type { TransferCommandPayload } from '@/types/movements';
import { buildClearedBedPatient } from '@/application/census/controllers/patientMovementCreationSharedController';
import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
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

  // A manual transfer undoes the mother together with her crib, so her copy keeps it.
  const transfers = [transferRow(ensurePatientClinicalEpisodeId(patient), false)];
  if (crib) transfers.push(transferRow(ensurePatientClinicalEpisodeId(crib), true));

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
