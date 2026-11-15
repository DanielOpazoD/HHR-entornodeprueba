import type { DailyRecordRawExportState } from '@/types/domain/dailyRecordSlices';

/** Read-only census projection. No remote lookups or patient writes belong here. */
export type MedifSourceRecord = Pick<DailyRecordRawExportState, 'date' | 'beds'> &
  Partial<Pick<DailyRecordRawExportState, 'activeExtraBeds' | 'lastUpdated'>>;
