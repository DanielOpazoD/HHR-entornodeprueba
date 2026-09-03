/**
 * Output contract for the Rayen → HHR census import.
 *
 * `reconcileCensus` produces a `CensusImportDiff` describing what *would* change
 * if the snapshot were applied. Phase 1 only computes and previews this diff;
 * it does not persist anything.
 */

import type { PatientData } from './rayenDomainContracts';
import type { RayenEncounter } from './rayenSnapshot';
import type { DischargeKind } from '../mapping/dischargeMapping';
import type { ReportEgreso } from './egresoReport';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';

export type DischargeVerificationState = 'confirmed' | 'not-detected' | 'unknown';

export interface DischargeVerification {
  medicalEpicrisis: DischargeVerificationState;
  nursingEpicrisis: DischargeVerificationState;
  hospitalDischarge: DischargeVerificationState;
}

/** A single field that differs between the current census patient and the Rayen data. */
export interface FieldChange {
  field: keyof PatientData;
  from: unknown;
  to: unknown;
}

/** A patient present in Rayen but not yet in the HHR census → will be admitted to a bed. */
export interface AdmissionEntry {
  bedId: string;
  patient: PatientData;
  isCma: boolean;
  /** Rayen evidence when the admission comes from the snapshot; absent for HHR-only retention. */
  source?: RayenEncounter;
}

export type CmaAdmissionDisposition = 'admit' | 'defer';

/** Explicit operator decision for one first-sync admission from an administrative CMA location. */
export interface CmaAdmissionResolution {
  admissionKey: string;
  disposition: CmaAdmissionDisposition;
}

/** Active newborn observed in an attached Rayen crib, keyed by its mother's physical bed. */
export interface ActiveClinicalCribEntry {
  parentBedId: string;
  /** Principal patient associated with that bed in the same Rayen snapshot/reconciliation. */
  principalRut?: string;
  patient: PatientData;
  source: RayenEncounter;
}

/** A matched patient in the same bed whose Rayen-sourced fields changed. */
export interface UpdateEntry {
  bedId: string;
  rut: string;
  patientName: string;
  changes: FieldChange[];
  patient: PatientData;
  source?: RayenEncounter;
}

/**
 * A matched patient whose Rayen bed differs from the HHR bed → relocated within the
 * census. This is a bed *move*, NOT a hospital transfer (hospital transfers are a
 * discharge kind — see `DischargeEntry`).
 */
export interface MoveEntry {
  fromBedId: string;
  toBedId: string;
  rut: string;
  patientName: string;
  source: RayenEncounter;
}

/** A patient leaving the census (discharged in Rayen, or absent from the snapshot). */
export interface DischargeEntry {
  bedId: string;
  rut: string;
  patientName: string;
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
  /** Only the Gestión de Camas administrative-discharge report may create this movement. */
  reason: 'administrative-discharge' | 'manual-bed-collision-resolution';
  /** Exact Rayen hospitalization when the administrative lookup resolved one episode. */
  encounterId?: string;
  /** Occupant identity observed during preview, used to reject stale same-bed discharges. */
  expectedOccupant?: {
    clinicalEpisodeId?: string;
    rut: string;
    admissionDate?: string;
    admissionTime?: string;
  };
  source?: RayenEncounter;
  /**
   * HHR nursing-census day + Rapa Nui time derived from the official "Alta Administrativa" report.
   * The wall clock is converted from mainland Chile and an event before the 08:00/09:00 handoff is
   * assigned to the previous census day.
   * When `correctedDay` is earlier than the census day being synced, the discharge belongs to that
   * previous day's record — the movement is filed there (behind confirmation), not on the sync day.
   */
  correctedDay?: string;
  correctedTime?: string;
  /** Independent evidence for the three documents that participate in the discharge workflow. */
  verification?: DischargeVerification;
  /**
   * Healthy newborn attached to the principal bed that leaves with the discharged mother.
   * It is persisted as a nested/associated movement for traceability, but never contributes to
   * the statistical egreso count because the newborn did not occupy an independent bed.
   */
  associatedClinicalCrib?: {
    clinicalEpisodeId: string;
    patientName: string;
    rut: string;
  };
}

/** One previous clinical day the sync would touch after explicit operator confirmation. */
export interface PreviousDayEdit {
  /** Island day (YYYY-MM-DD) whose record would be modified. */
  day: string;
  reason: 'discharge-day-correction' | 'admission-night-shift-correction';
  patientNames: string[];
  /** Whether a daily record already exists for that day. */
  recordExists: boolean;
  /** Whether a nurse may still write it (Firestore ~48h editing window); false → needs admin. */
  withinEditingWindow: boolean;
  /** Whether that day's record carries a medical signature (already "closed"). */
  isSigned: boolean;
  /**
   * Exact admission subjects shown for confirmation. Kept with the transient preview diff so the
   * writer never derives a broader set of historical admissions from the raw current-day diff.
   */
  admissionSubjects?: Array<{
    kind: 'principal' | 'clinical-crib';
    bedId: string;
    clinicalEpisodeId?: string;
    rut?: string;
  }>;
  /**
   * Ingresos históricos que NO se aplicarán ese día, con su motivo (p.ej. la
   * cama del día previo sigue ocupada por otro paciente). Se muestran en la
   * revisión y no participan de la escritura: una condición de dominio
   * inaplicable no debe degradar la corrida a «requiere una nueva captura».
   */
  omittedAdmissions?: Array<{ patientName: string; reason: string }>;
}

/**
 * A patient with a Ficha Médico closure signal who is KEPT in their HHR bed. Neither medical
 * nor nursing closure finalizes a statistical departure: the sync waits for the Gestión de Camas
 * administrative-discharge report.
 */
export interface PendingAdministrativeDischargeEntry {
  bedId: string;
  rut: string;
  patientName: string;
  /** Signal observed in Ficha Médico. It is informative and never vacates the HHR bed. */
  signal: 'clinical-closure' | 'missing-from-ficha';
  /** Exact Rayen hospitalization. Required by the individual fallback to avoid cross-episode matches. */
  encounterId?: string;
  verification: DischargeVerification;
  source?: RayenEncounter;
}

/** Something that cannot be applied automatically and needs human resolution. */
export interface ConflictEntry {
  bedId: string | null;
  rut?: string;
  patientName?: string;
  /** Domain scope used when a later reconciliation stage must preserve an unresolved conflict. */
  scope?: 'clinical-crib';
  /** Stable machine-readable discriminator for conflicts consumed across reconciliation stages. */
  code?:
    | 'unconfirmed-principal-bed'
    | 'principal-bed-collision'
    | 'cma-physical-bed-collision'
    | 'occupied-local-bed'
    | 'historical-reconstruction'
    | 'historical-admission-evidence'
    | 'unverified-report-row'
    | 'episode-less-report-row'
    | 'report-predates-admission';
  /** Admission held back only because its target bed was occupied when the snapshot was planned. */
  blockedAdmission?: AdmissionEntry;
  /** Move held back only because its target bed was occupied when the snapshot was planned. */
  blockedMove?: MoveEntry;
  reason: string;
  source?: RayenEncounter;
}

export type BedOccupancyCollisionSource = 'cma' | 'medical-surgical';

export interface BedOccupancyCollisionCandidate {
  clinicalEpisodeId: string;
  sourceKind: BedOccupancyCollisionSource;
  patient: PatientData;
  source: RayenEncounter;
  /** Current HHR position, when this episode is already present in the selected census. */
  currentBedId?: string;
}

export type CmaEquivalentBedId = 'R1' | 'R2' | 'R3' | 'R4' | 'NEO1' | 'NEO2';

/** Two distinct Rayen source beds that both map to one physical HHR bed. */
export interface BedOccupancyCollision {
  id: string;
  bedId: CmaEquivalentBedId;
  candidates: [BedOccupancyCollisionCandidate, BedOccupancyCollisionCandidate];
  /** Free HHR beds offered for an explicit relocation of the candidate that does not stay. */
  availableAlternativeBedIds: string[];
}

export type BedOccupancyCollisionDisposition =
  | { kind: 'discharge' }
  | { kind: 'transfer' }
  | { kind: 'remove' }
  | { kind: 'move'; targetBedId: string };

export interface BedOccupancyCollisionResolution {
  collisionId: string;
  selectedEpisodeId: string;
  otherDisposition: BedOccupancyCollisionDisposition;
}

export interface CensusImportSummary {
  admissions: number;
  updates: number;
  moves: number;
  discharges: number;
  pendingAdministrativeDischarges: number;
  conflicts: number;
  unchanged: number;
  /** How many previous days would be modified (discharge-day corrections). Optional/back-compat. */
  previousDaysAffected?: number;
}

export interface CensusImportDiff {
  admissions: AdmissionEntry[];
  updates: UpdateEntry[];
  moves: MoveEntry[];
  discharges: DischargeEntry[];
  /** Clinical closure signals kept in bed until Gestión de Camas confirms administrative discharge. */
  pendingAdministrativeDischarges: PendingAdministrativeDischargeEntry[];
  conflicts: ConflictEntry[];
  /** Explicit review gate for simultaneous CMA and equivalent physical-bed occupancy. */
  bedOccupancyCollisions?: BedOccupancyCollision[];
  /** Operator decisions attached only after the preview has been fully reviewed. */
  bedOccupancyCollisionResolutions?: BedOccupancyCollisionResolution[];
  /**
   * Durable collision decisions that still match the live Rayen placements. They protect the
   * retained episode from an older administrative-discharge row during this import only.
   */
  retainedBedCollisionResolutions?: RayenBedCollisionResolutionReceipt[];
  /**
   * Active attached cribs observed in Ficha Médico. The administrative-discharge enrichment uses
   * this evidence to promote a newborn to the physical bed when its mother leaves first.
   */
  activeClinicalCribs?: ActiveClinicalCribEntry[];
  /** Every active hospitalization episode present in the captured Ficha snapshot. */
  activeClinicalEpisodeIds?: string[];
  /** Whether absence from the captured Ficha census is safe to use as evidence. */
  snapshotComplete?: boolean;
  /**
   * Egresos from the bulk "Alta Administrativa" report whose RUN is unknown to HHR (patients
   * admitted and discharged between two syncs, so they never occupied an HHR bed). Informational
   * — surfaced in the preview for the nurse to review, never auto-applied. Optional: only present
   * once the report has been consulted (see `applyEgresoReport`).
   */
  reportEgresos?: ReportEgreso[];
  /**
   * Previous days this sync would modify — a discharge whose official island egreso day is earlier
   * than the census day. Surfaced in the preview behind an explicit "modify previous days" confirm;
   * never auto-applied. Present only once the egreso report has been consulted.
   */
  previousDayEdits?: PreviousDayEdit[];
  /**
   * Transient admission-shaped candidates derived from updates that attach a new clinical crib to
   * a mother already present in HHR. They are used only by the confirmed D/D-1 correction writer.
   */
  previousDayAdmissionCandidates?: AdmissionEntry[];
  /**
   * Beds whose optional D-1 admission backfill could not be proven. This is non-blocking for the
   * authoritative selected-day census, but is retained so history can explain what was not changed.
   */
  deferredHistoricalAdmissionBedIds?: string[];
  unchangedCount: number;
  summary: CensusImportSummary;
}
