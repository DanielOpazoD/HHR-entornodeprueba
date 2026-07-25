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

  const nightTens = prevRecord.tensNightShift || [];
  const dayTens = prevRecord.tensDayShift || [];
  const isNightTensEmpty = nightTens.every(t => !t);
  const rawTens = !isNightTensEmpty ? nightTens : dayTens;
  const tensDay = [...rawTens];
  while (tensDay.length < 3) tensDay.push('');

  return {
    nursesDay: ['', ''],
    nursesNight: ['', ''],
    tensDay: tensDay.slice(0, 3),
    tensNight: ['', '', ''],
  };
};
