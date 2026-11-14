import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import { resolveHandoffShiftStaff } from '@/services/staff/dailyRecordStaffing';

export const mergeMonthlyRecordsForBackup = (
  monthRecords: CensusExportRecord[],
  currentRecord: CensusExportRecord | null,
  currentDateString: string,
  limitDate: string
): CensusExportRecord[] => {
  const filteredRecords = monthRecords
    .filter(record => record.date <= limitDate)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (currentRecord && !filteredRecords.some(record => record.date === currentDateString)) {
    filteredRecords.push(currentRecord);
    filteredRecords.sort((left, right) => left.date.localeCompare(right.date));
  }

  return filteredRecords;
};

export const resolveHandoffBackupStaff = (
  record: DailyRecordStaffingState,
  selectedShift: 'day' | 'night'
): { delivers: string[]; receives: string[] } => resolveHandoffShiftStaff(record, selectedShift);
