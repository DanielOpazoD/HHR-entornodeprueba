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
  /**
   * The person who leaves, exactly as undo must restore them; the caller decides. A manual mother
   * keeps her crib (undo brings both back); Eloísa passes her without a crib that has its own row.
   */
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
 * the person who leaves with their own data (a newborn is «(Cuna RN)» with its own insurance and
 * origin, ID-03) and carries the undo snapshot of exactly the patient it is given.
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
