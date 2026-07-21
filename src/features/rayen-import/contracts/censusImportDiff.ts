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
  reason: 'administrative-discharge';
  /** Exact Rayen hospitalization when the administrative lookup resolved one episode. */
  encounterId?: string;
  source?: RayenEncounter;
  /**
   * Rapa Nui day + time of the egreso as printed by the official "Alta Administrativa" report.
   * The D+1 workaround expands only the search range; it never shifts this statistical timestamp.
   * When `correctedDay` is earlier than the census day being synced, the discharge belongs to that
   * previous day's record — the movement is filed there (behind confirmation), not on the sync day.
   */
  correctedDay?: string;
  correctedTime?: string;
  /** Independent evidence for the three documents that participate in the discharge workflow. */
  verification?: DischargeVerification;
}

/** One previous day the sync would touch (Capability A: a discharge whose real island day is earlier). */
export interface PreviousDayEdit {
  /** Island day (YYYY-MM-DD) whose record would be modified. */
  day: string;
  reason: 'discharge-day-correction';
  patientNames: string[];
  /** Whether a daily record already exists for that day. */
  recordExists: boolean;
  /** Whether a nurse may still write it (Firestore ~48h editing window); false → needs admin. */
  withinEditingWindow: boolean;
  /** Whether that day's record carries a medical signature (already "closed"). */
  isSigned: boolean;
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
  code?: 'unconfirmed-principal-bed' | 'principal-bed-collision';
  reason: string;
  source?: RayenEncounter;
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
  /**
   * Active attached cribs observed in Ficha Médico. The administrative-discharge enrichment uses
   * this evidence to promote a newborn to the physical bed when its mother leaves first.
   */
  activeClinicalCribs?: ActiveClinicalCribEntry[];
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
  unchangedCount: number;
  summary: CensusImportSummary;
}
