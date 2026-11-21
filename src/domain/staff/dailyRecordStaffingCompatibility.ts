import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';

export type DailyRecordStaffingCompatShape = Pick<
  DailyRecordStaffingState,
  'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'
>;

export const normalizeStaffSlots = (staff?: string[] | null, slotCount = 0): string[] => {
  const normalized = Array.isArray(staff) ? staff.map(value => value?.trim() || '') : [];
  while (normalized.length < slotCount) normalized.push('');
  return normalized.slice(0, slotCount || normalized.length);
};

/**
 * Stored shift lists are positional: item i is grid slot i (`dailyRecordDetailedStaffing`), so
 * reading keeps an empty slot before a name. Only trailing empty slots, which hold no position,
 * are dropped.
 */
export const readStoredShiftSlots = (staff?: string[] | null): string[] => {
  const slots = normalizeStaffSlots(staff);
  while (slots.length > 0 && !slots[slots.length - 1]) slots.pop();
  return slots;
};

export const resolveStoredDayShiftSlots = (record: DailyRecordStaffingCompatShape): string[] => {
  for (const staff of [record.nursesDayShift, record.nurses]) {
    const slots = readStoredShiftSlots(staff);
    if (slots.length > 0) return slots;
  }
  return readStoredShiftSlots([record.nurseName ?? '']);
};

export const toEmptyShiftPair = (staff: string[]): string[] =>
  staff.length > 0 ? staff : ['', ''];

export const applyDailyRecordStaffingCompatibility = <T extends DailyRecordStaffingCompatShape>(
  record: T
): T => {
  const resolvedDayShift = toEmptyShiftPair(resolveStoredDayShiftSlots(record));
  const resolvedNightShift = toEmptyShiftPair(readStoredShiftSlots(record.nursesNightShift));

  return {
    ...record,
    // Legacy `nurses` is kept only as a compatibility mirror of the canonical day shift field.
    nurses: [...resolvedDayShift],
    nursesDayShift: [...resolvedDayShift],
    nursesNightShift: [...resolvedNightShift],
  };
};
