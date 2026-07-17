import type { DailyRecord } from './dailyRecord';

export type DailyRecordDateRef = Pick<DailyRecord, 'date'>;
export type DailyRecordBackfillRef = DailyRecordDateRef;

export type DailyRecordMetadataState = Pick<DailyRecord, 'date' | 'dateTimestamp' | 'lastUpdated'>;

export type DailyRecordBedsState = Pick<DailyRecord, 'beds'>;

export type DailyRecordBedLayoutState = Pick<
  DailyRecord,
  'beds' | 'activeExtraBeds' | 'bedTypeOverrides'
>;

export type DailyRecordCriticalValidationState = Pick<DailyRecord, 'beds' | 'activeExtraBeds'>;

export type DailyRecordBedAuditState = Pick<DailyRecord, 'date' | 'beds'>;

export type DailyRecordMovementState = Pick<
  DailyRecord,
  'date' | 'beds' | 'discharges' | 'transfers' | 'cma'
>;

export type DailyRecordMovementCollectionsState = Pick<
  DailyRecord,
  'discharges' | 'transfers' | 'cma'
>;

export type DailyRecordPatientHistoryState = DailyRecordMovementState;

export type DailyRecordStaffingState = Pick<
  DailyRecord,
  | 'nurses'
  | 'nurseName'
  | 'nursesDayShift'
  | 'nursesNightShift'
  | 'tensDayShift'
  | 'tensNightShift'
  | 'staffingDetailsV1'
  | 'date'
  | 'handoffNightReceives'
>;

export type DailyRecordMedicalMessagingState = Pick<
  DailyRecord,
  'date' | 'beds' | 'medicalHandoffDoctor'
>;

export type DailyRecordMedicalHandoffSummaryState = Pick<
  DailyRecord,
  'date' | 'medicalHandoffNovedades' | 'medicalHandoffBySpecialty'
>;

export type DailyRecordCmaState = Pick<DailyRecord, 'cma'>;

export type DailyRecordCudyrState = Pick<DailyRecord, 'date' | 'beds' | 'activeExtraBeds'>;
export type DailyRecordCudyrExportState = DailyRecordCudyrState & Pick<DailyRecord, 'lastUpdated'>;

export type DailyRecordCsvExportState = Pick<
  DailyRecord,
  | 'beds'
  | 'discharges'
  | 'transfers'
  | 'nurses'
  | 'nurseName'
  | 'nursesDayShift'
  | 'nursesNightShift'
>;

export type DailyRecordRawExportState = Pick<
  DailyRecord,
  | 'date'
  | 'beds'
  | 'bedTypeOverrides'
  | 'activeExtraBeds'
  | 'lastUpdated'
  | 'nurses'
  | 'nurseName'
  | 'nursesDayShift'
  | 'nursesNightShift'
>;

export type DailyRecordHandoffPdfState = Pick<
  DailyRecord,
  | 'date'
  | 'beds'
  | 'discharges'
  | 'transfers'
  | 'cma'
  | 'handoffDayChecklist'
  | 'handoffNightChecklist'
  | 'handoffNovedadesDayShift'
  | 'handoffNovedadesNightShift'
  | 'cudyrUpdatedAt'
  | 'cudyrUpdatedBy'
  | 'cudyrUpdatedById'
  | 'cudyrShiftDate'
  | 'cudyrCompletedAt'
  | 'cudyrCompletedBy'
  | 'cudyrLockedAt'
  | 'nurses'
  | 'nurseName'
  | 'nursesDayShift'
  | 'nursesNightShift'
  | 'tensDayShift'
  | 'tensNightShift'
  | 'staffingDetailsV1'
  | 'handoffNightReceives'
>;

export type DailyRecordIntegrityState = Pick<
  DailyRecord,
  | 'date'
  | 'beds'
  | 'discharges'
  | 'transfers'
  | 'cma'
  | 'nursesDayShift'
  | 'nursesNightShift'
  | 'tensDayShift'
  | 'tensNightShift'
  | 'handoffNovedadesDayShift'
  | 'handoffNovedadesNightShift'
  | 'medicalHandoffNovedades'
  | 'medicalHandoffBySpecialty'
>;
