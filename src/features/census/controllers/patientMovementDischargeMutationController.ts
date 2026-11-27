import type { PatientData } from '@/types/domain/patient';

import { BedDefinition } from '@/types/domain/beds';
import { DischargeData, DischargeType } from '@/types/domain/movements';

import type { DischargeAddCommandPayload } from '@/types/movements';
import {
  buildClearedBedPatient,
  type MovementAuditEntry,
} from '@/features/census/controllers/patientMovementCreationSharedController';
import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import type { MovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';
import { buildMovementRow } from '@/application/census/movementRowBuilder';

interface BuildDischargeEntriesParams {
  patient: PatientData;
  bedId: string;
  bedDef?: BedDefinition;
  payload: DischargeAddCommandPayload;
  resolvedMovementDate: string;
  createId: () => string;
  provenance?: MovementProvenanceSeed;
}

export const buildDischargeEntries = ({
  patient,
  bedId,
  bedDef,
  payload,
  resolvedMovementDate,
  createId,
  provenance,
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
  const stamp = { movementDate: resolvedMovementDate, time: time || '' };
  const crib = patient.clinicalCrib;
  const cribLeaves =
    (target === 'baby' || target === 'both') && !!crib?.patientName && !!cribStatus;
  const recordDischarge = (
    person: PatientData,
    isNested: boolean,
    personStatus: DischargeData['status']
  ) => {
    const movementId = createId();
    const subtype = {
      dischargeType: personStatus === 'Vivo' ? (dischargeType as DischargeType) : undefined,
      dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
    };
    discharges.push({
      ...buildMovementRow({
        id: movementId,
        patient: person,
        bedId,
        bedDef,
        stamp,
        isNested,
        provenance,
      }),
      status: personStatus,
      ...(isNested ? {} : subtype),
    });
    auditEntries.push({
      movementId,
      bedId,
      patientName: person.patientName,
      rut: person.rut,
      status: personStatus,
      diagnosis: person.pathology,
      ...stamp,
      ...subtype,
      clinicalEpisodeId: person.clinicalEpisodeId,
    });
  };

  // A manual discharge undoes the mother together with her crib, so her copy keeps it.
  if (target === 'mother' || target === 'both') {
    recordDischarge(ensurePatientClinicalEpisodeId(patient), false, status);
  }

  if (cribLeaves && crib && cribStatus) {
    recordDischarge(ensurePatientClinicalEpisodeId(crib), true, cribStatus);
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
