import type { DailyRecordHandoffPdfState } from '@/services/contracts/dailyRecordServiceContracts';

export type HandoffPdfRecord = DailyRecordHandoffPdfState;

export type HandoffPdfStaffingRecord = Pick<
  HandoffPdfRecord,
  | 'date'
  | 'nurses'
  | 'nurseName'
  | 'nursesDayShift'
  | 'nursesNightShift'
  | 'tensDayShift'
  | 'tensNightShift'
  | 'staffingDetailsV1'
  | 'handoffNightReceives'
>;

export type HandoffPdfPatientTableRecord = Pick<HandoffPdfRecord, 'date' | 'beds'>;
export type HandoffPdfMovementsRecord = Pick<HandoffPdfRecord, 'discharges' | 'transfers' | 'cma'>;
export type HandoffPdfChecklistRecord = Pick<
  HandoffPdfRecord,
  'handoffSharedChecklist' | 'handoffDayChecklist' | 'handoffNightChecklist'
>;
export type HandoffPdfNovedadesRecord = Pick<
  HandoffPdfRecord,
  'handoffNovedadesDayShift' | 'handoffNovedadesNightShift'
>;
