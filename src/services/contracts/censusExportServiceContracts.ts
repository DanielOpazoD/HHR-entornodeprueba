import type {
  DailyRecordBedLayoutState,
  DailyRecordCmaState,
  DailyRecordCsvExportState,
  DailyRecordMetadataState,
} from '@/types/domain/dailyRecordSlices';

export type CensusExportRecord = DailyRecordMetadataState &
  Pick<DailyRecordBedLayoutState, 'beds' | 'bedTypeOverrides' | 'activeExtraBeds'> &
  Pick<
    DailyRecordCsvExportState,
    'discharges' | 'transfers' | 'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'
  > &
  DailyRecordCmaState;
