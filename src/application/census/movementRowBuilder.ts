import type { PatientData } from '@/types/domain/patient';
import type { BedDefinition } from '@/types/domain/beds';
import { buildMovementUndoSnapshot } from '@/utils/movementUndoSnapshot';
import {
  buildMovementProvenance,
  type MovementProvenanceSeed,
} from '@/application/census/movementProvenancePolicy';

/** Day and time of a movement: the form's (manual) or Gestión de Camas' (Eloísa). */
export interface MovementStamp {
  movementDate: string;
  time: string;
  movementDateSource?: 'official';
}

interface MovementRowInput {
  id: string;
  /** The person who leaves. A mother whose crib gets its own row comes without `clinicalCrib`. */
  patient: PatientData;
  bedId: string;
  bedDef?: Pick<BedDefinition, 'name' | 'type'>;
  stamp: MovementStamp;
  /** The newborn of a clinical crib, recorded as its own person (ID-03). */
  isNested: boolean;
  provenance?: MovementProvenanceSeed;
}

/**
 * The fields every discharge and transfer row shares, manual or from Eloísa. The row describes
 * the person who leaves with their own data, keeps their episode id as stored (never derives
 * one) and carries a snapshot of exactly that person so each row undoes on its own.
 */
export const buildMovementRow = ({
  id,
  patient,
  bedId,
  bedDef,
  stamp,
  isNested,
  provenance,
}: MovementRowInput) => {
  const bedName = bedDef?.name || bedId;
  return {
    id,
    ...stamp,
    admissionDate: patient.admissionDate || undefined,
    clinicalEpisodeId: patient.clinicalEpisodeId,
    bedName: isNested ? `${bedName} (Cuna RN)` : bedName,
    bedId,
    bedType: isNested ? 'Cuna' : bedDef?.type || '',
    patientName: patient.patientName,
    rut: patient.rut,
    diagnosis: patient.pathology,
    specialty:
      typeof patient.specialty === 'string' ? patient.specialty : String(patient.specialty),
    age: patient.age || undefined,
    insurance: patient.insurance,
    origin: patient.origin,
    isRapanui: patient.isRapanui,
    originalData: buildMovementUndoSnapshot(patient),
    isNested,
    movementProvenance: provenance
      ? buildMovementProvenance({ movementId: id, ...provenance })
      : undefined,
  };
};
