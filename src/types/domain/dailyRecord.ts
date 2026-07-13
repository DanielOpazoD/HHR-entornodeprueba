import type { BedType } from './base';
import type { PatientData } from './patient';
import type { DischargeData, TransferData, CMAData } from './movements';
import type {
  MedicalHandoffBySpecialty,
  MedicalSignature,
  MedicalSignatureByScope,
  MedicalSignatureScope,
  MedicalSignatureTimestampByScope,
} from './dailyRecordMedicalHandoff';
import type {
  DailyRecordHandoffDayChecklist,
  DailyRecordHandoffNightChecklist,
} from './dailyRecordNursingHandoff';
import type { DailyRecordStaffingDetailsV1 } from './dailyRecordStaffingDetails';
export type {
  MedicalHandoffActor,
  MedicalHandoffBySpecialty,
  MedicalHandoffDailyContinuityEntry,
  MedicalSignature,
  MedicalSignatureByScope,
  MedicalSignatureScope,
  MedicalSignatureTimestampByScope,
  MedicalSpecialty,
  MedicalSpecialtyHandoffNote,
} from './dailyRecordMedicalHandoff';
export type { DailyRecordPatch, DailyRecordPatchPath } from './dailyRecordPatch';
export type {
  DailyRecordHandoffDayChecklist,
  DailyRecordHandoffNightChecklist,
} from './dailyRecordNursingHandoff';

/** Metadata of the last Eloísa (Rayen) census sync applied to this record. */
export interface RayenSyncMeta {
  /** Instant the sync was applied (ISO 8601, absolute — format at display in island time). */
  at: string;
  /** Display name (or email) of the user who ran the sync. */
  by: string;
}

export interface DailyRecord {
  date: string;
  beds: Record<string, PatientData>;
  bedTypeOverrides?: Record<string, BedType>;
  discharges: DischargeData[];
  transfers: TransferData[];
  cma: CMAData[]; // Cirugía Mayor Ambulatoria
  lastUpdated: string;
  /** Last Eloísa sync applied to this day (who + when) — shown next to the sync button. */
  rayenSync?: RayenSyncMeta;
  /** Unix timestamp (ms) for the start of the day, used for security rule validation */
  dateTimestamp?: number;
  /** Version of the data structure, used to prevent corruption from old clients */
  schemaVersion?: number;
  /** @deprecated Use nursesDayShift / nursesNightShift instead. Maintained only for legacy compatibility on read. */
  nurses?: string[];
  /** @deprecated Use nursesDayShift[0]. Maintained only for legacy compatibility on read. */
  nurseName?: string;
  nursesDayShift?: string[]; // Turno Largo nurses
  nursesNightShift?: string[]; // Turno Noche nurses
  tensDayShift?: string[]; // Turno Largo TENS (max 3)
  tensNightShift?: string[]; // Turno Noche TENS (max 3)
  staffingDetailsV1?: DailyRecordStaffingDetailsV1;
  activeExtraBeds: string[];

  // ===== Handoff Checklist - Day Shift (Turno Largo) =====
  handoffDayChecklist?: DailyRecordHandoffDayChecklist;

  // ===== Handoff Checklist - Night Shift (Turno Noche) =====
  handoffNightChecklist?: DailyRecordHandoffNightChecklist;

  // ===== Handoff Novedades (Free text section) =====
  handoffNovedadesDayShift?: string;
  handoffNovedadesNightShift?: string;

  // ===== Nurse Handoff Identification =====
  handoffNightReceives?: string[]; // Nurses who receive night shift (Next day's night or unique)

  // ===== Medical Handoff Novedades =====
  medicalHandoffNovedades?: string; // Free text novedades for medical handoff
  medicalHandoffBySpecialty?: MedicalHandoffBySpecialty;

  // ===== Medical Handoff Signature =====
  medicalHandoffDoctor?: string; // Doctor delivering the shift
  medicalHandoffSentAt?: string; // Timestamp when the share link was clicked
  medicalHandoffSentAtByScope?: MedicalSignatureTimestampByScope;
  medicalSignatureLinkTokenByScope?: Partial<Record<MedicalSignatureScope, string>>;
  medicalSignature?: MedicalSignature;
  medicalSignatureByScope?: MedicalSignatureByScope;

  // ===== CUDYR Lock (Prevents new patients from being added to CUDYR after cutoff) =====
  /** Whether CUDYR editing is locked for this day */
  cudyrLocked?: boolean;
  /** ISO timestamp when CUDYR was locked */
  cudyrLockedAt?: string;
  /** User ID who locked the CUDYR */
  cudyrLockedBy?: string;
  /** ISO timestamp when the last CUDYR score or closure was saved */
  cudyrUpdatedAt?: string;
}
