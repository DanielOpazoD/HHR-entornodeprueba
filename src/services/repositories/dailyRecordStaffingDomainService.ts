import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';

export interface InheritedDailyRecordStaffing {
  nursesDay: string[];
  nursesNight: string[];
  tensDay: string[];
  tensNight: string[];
}

export const resolveInheritedDailyRecordStaffing = (
  prevRecord: DailyRecordStaffingState | null
): InheritedDailyRecordStaffing => {
  if (!prevRecord) {
    return {
      nursesDay: ['', ''],
      nursesNight: ['', ''],
      tensDay: ['', '', ''],
      tensNight: ['', '', ''],
    };
  }

  return {
    nursesDay: ['', ''],
    nursesNight: ['', ''],
    // Staff rosters belong to a specific clinical shift. Copying last night's TENS into the new
    // long shift creates false assignments and prevents Eloísa evidence from filling vacancies.
    tensDay: ['', '', ''],
    tensNight: ['', '', ''],
  };
};
