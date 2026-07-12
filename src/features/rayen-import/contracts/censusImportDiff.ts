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
  source: RayenEncounter;
}

/** A matched patient in the same bed whose Rayen-sourced fields changed. */
export interface UpdateEntry {
  bedId: string;
  rut: string;
  patientName: string;
  changes: FieldChange[];
  patient: PatientData;
  source: RayenEncounter;
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
  reason: 'rayen-discharge' | 'missing-in-rayen';
  source?: RayenEncounter;
  /**
   * Rapa Nui (island) day + time of the egreso as told by the official "Alta Administrativa" report,
   * already TZ-corrected from continental Chile (see `continentalReportToRapaNui`). When
   * `correctedDay` is earlier than the census day being synced, the discharge belongs to that
   * previous day's record — the movement is filed there (behind confirmation), not on the sync day.
   */
  correctedDay?: string;
  correctedTime?: string;
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
 * A patient with a Rayen medical discharge (alta médica) who is KEPT in their HHR bed.
 * The nurse's discharge in HHR (alta de enfermería) is the sole event that finalizes a
 * departure, so the sync never vacates the bed for a medical discharge — it only reports
 * the pending state so the nurse knows to complete the discharge in HHR.
 */
export interface PendingNursingDischargeEntry {
  bedId: string;
  rut: string;
  patientName: string;
  /** How the eventual HHR discharge would be classified (alta | traslado | cma). */
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
  source: RayenEncounter;
}

/** Something that cannot be applied automatically and needs human resolution. */
export interface ConflictEntry {
  bedId: string | null;
  rut?: string;
  patientName?: string;
  reason: string;
  source?: RayenEncounter;
}

export interface CensusImportSummary {
  admissions: number;
  updates: number;
  moves: number;
  discharges: number;
  pendingNursingDischarges: number;
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
  /** Medical discharges kept in the bed until the nurse completes the discharge in HHR. */
  pendingNursingDischarges: PendingNursingDischargeEntry[];
  conflicts: ConflictEntry[];
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
