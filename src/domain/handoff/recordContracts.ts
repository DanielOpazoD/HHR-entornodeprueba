import type { DailyRecordPatch as RootDailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type {
  MedicalHandoffActor as RootMedicalHandoffActor,
  MedicalSpecialty as RootMedicalSpecialty,
  MedicalHandoffBySpecialty,
  MedicalHandoffDailyContinuityEntry as RootMedicalHandoffDailyContinuityEntry,
  MedicalSpecialtyHandoffNote as RootMedicalSpecialtyHandoffNote,
} from '@/types/domain/dailyRecordMedicalHandoff';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';
import type { DailyRecord as ApplicationDailyRecord } from '@/application/shared/dailyRecordCoreContracts';

export type MedicalHandoffActor = RootMedicalHandoffActor;
export type MedicalSpecialty = RootMedicalSpecialty;
export type DailyRecordPatch = RootDailyRecordPatch;
export type MedicalSpecialtyHandoffNote = RootMedicalSpecialtyHandoffNote;
export type MedicalHandoffDailyContinuityEntry = RootMedicalHandoffDailyContinuityEntry;

export interface HandoffDailyRecordContract {
  date: string;
  beds: Record<string, HandoffPatientContract>;
  discharges: DischargeData[];
  transfers: TransferData[];
  cma: CMAData[];
  lastUpdated: string;
  nursesDayShift?: string[];
  nursesNightShift?: string[];
  tensDayShift?: string[];
  tensNightShift?: string[];
  activeExtraBeds: string[];
  handoffSharedChecklist?: ApplicationDailyRecord['handoffSharedChecklist'];
  handoffDayChecklist?: ApplicationDailyRecord['handoffDayChecklist'];
  handoffNightChecklist?: ApplicationDailyRecord['handoffNightChecklist'];
  handoffNovedadesDayShift?: string;
  handoffNovedadesNightShift?: string;
  handoffNightReceives?: string[];
  medicalHandoffNovedades?: string;
  medicalHandoffBySpecialty?: MedicalHandoffBySpecialty;
  medicalHandoffDoctor?: string;
  medicalHandoffSentAt?: string;
  medicalHandoffSentAtByScope?: ApplicationDailyRecord['medicalHandoffSentAtByScope'];
  medicalSignatureLinkTokenByScope?: ApplicationDailyRecord['medicalSignatureLinkTokenByScope'];
  medicalSignature?: ApplicationDailyRecord['medicalSignature'];
  medicalSignatureByScope?: ApplicationDailyRecord['medicalSignatureByScope'];
}

/**
 * Handoff modules should depend on the narrowed handoff-facing contract rather
 * than the root persistence shape.
 */
export type DailyRecord = HandoffDailyRecordContract;
