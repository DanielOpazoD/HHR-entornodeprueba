import type { PatientData } from './patient';

export type DischargeType = 'Domicilio (Habitual)' | 'Voluntaria' | 'Fuga' | 'Otra';

export interface IeehData {
  diagnosticoPrincipal?: string;
  cie10Code?: string;
  condicionEgreso?: string;
  intervencionQuirurgica?: string;
  intervencionQuirurgDescrip?: string;
  procedimiento?: string;
  procedimientoDescrip?: string;
  tratanteApellido1?: string;
  tratanteApellido2?: string;
  tratanteNombre?: string;
  tratanteRut?: string;
}

export interface MovementTombstoneFields {
  deletedAt?: string;
  deletedBy?: string;
  deletedReason?: string;
}

export interface MovementEpisodeFields {
  /** Stable episode identifier. Optional while legacy movement rows are backfilled. */
  clinicalEpisodeId?: string;
  /** Optional operational provenance. Missing on legacy movements by design. */
  movementProvenance?: MovementProvenance;
}

export type MovementClassification = 'discharge' | 'transfer' | 'cma';
export type MovementProvenanceSource = 'manual' | 'gestion_camas' | 'reclassified';

export interface MovementProvenance {
  /** What produced the movement's current classification. */
  source: MovementProvenanceSource;
  /** Stable across every reclassification of the same egreso. */
  lineageId: string;
  classifiedAt: string;
  classifiedBy?: string;
  /** Eloísa run that supplied the authoritative Gestión de Camas report. */
  syncRunId?: string;
  /** Immediate predecessor; its tombstone keeps the rest of the chain. */
  previousMovementId?: string;
  previousClassification?: MovementClassification;
}

export interface DischargeData extends MovementTombstoneFields, MovementEpisodeFields {
  id: string;
  movementDate?: string; // YYYY-MM-DD
  admissionDate?: string; // Explicit episode admission date for reporting
  bedName: string;
  bedId: string; // Needed for undo
  bedType: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  specialty?: string;
  time: string;
  status: 'Vivo' | 'Fallecido';
  dischargeType?: DischargeType; // Sub-classification for 'Vivo'
  dischargeTypeOther?: string; // Description if 'Otra'
  age?: string;
  insurance?: string;
  origin?: string;
  isRapanui?: boolean;
  originalData?: PatientData; // Snapshot for Undo
  isNested?: boolean; // Identifies if it was a clinical crib
  ieehData?: IeehData; // Persisted IEEH PDF generation data
}

export interface TransferData extends MovementTombstoneFields, MovementEpisodeFields {
  id: string;
  movementDate?: string; // YYYY-MM-DD
  admissionDate?: string; // Explicit episode admission date for reporting
  bedName: string;
  bedId: string; // Needed for undo
  bedType: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  specialty?: string;
  time: string;
  evacuationMethod: string;
  evacuationMethodOther?: string;
  receivingCenter: string;
  receivingCenterOther?: string;
  transferEscort?: string;
  age?: string;
  insurance?: string;
  origin?: string;
  isRapanui?: boolean;
  originalData?: PatientData; // Snapshot for Undo
  isNested?: boolean; // Identifies if it was a clinical crib
}

export interface CMAData extends MovementTombstoneFields, MovementEpisodeFields {
  id: string;
  bedName: string; // Generic location or identifier
  patientName: string;
  rut: string;
  age: string;
  birthDate?: string;
  biologicalSex?: 'Masculino' | 'Femenino' | 'Indeterminado';
  insurance?: 'Fonasa' | 'Isapre' | 'Particular';
  admissionOrigin?: 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
  admissionOriginDetails?: string;
  origin?: 'Residente' | 'Turista Nacional' | 'Turista Extranjero';
  isRapanui?: boolean;
  diagnosis: string;
  cie10Code?: string;
  cie10Description?: string;
  specialty: string;
  interventionType: 'Cirugía Mayor Ambulatoria' | 'Procedimiento Médico Ambulatorio'; // New field
  dischargeTime?: string; // Time when patient was discharged (HH:MM format)
  enteredBy?: string; // Optional: user who added the record
  timestamp?: string; // Optional: creation time
  originalBedId?: string; // For undo: original bed ID
  originalData?: PatientData; // For undo: snapshot of original patient data
}

export const resolveCmaHistoricalAdmissionDate = (
  movement: Pick<CMAData, 'originalData'>
): string => movement.originalData?.admissionDate || '';

interface MovementHistoricalEpisodeSnapshot {
  admissionDate?: string;
  originalData?: Pick<PatientData, 'admissionDate' | 'firstSeenDate' | 'admissionTime'>;
}

export const resolveMovementHistoricalAdmissionDate = (
  movement: MovementHistoricalEpisodeSnapshot
): string | undefined =>
  movement.admissionDate ||
  movement.originalData?.firstSeenDate ||
  movement.originalData?.admissionDate;

export const resolveMovementHistoricalAdmissionTime = (
  movement: MovementHistoricalEpisodeSnapshot
): string | undefined => movement.originalData?.admissionTime;
