import type { MedicalHandoffBySpecialty } from '@/types/domain/dailyRecordMedicalHandoff';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';
import type { DailyRecord as ApplicationDailyRecord } from '@/types/domain/dailyRecord';

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
