import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

// Patch builders for the nursing handoff screen: each returns only the changed field, so two
// people editing different fields of the same day keep both edits.

export const buildChecklistPatch = (
  shift: 'day' | 'night' | 'shared',
  field: string,
  value: boolean | string
): DailyRecordPatch => {
  const key =
    shift === 'shared'
      ? 'handoffSharedChecklist'
      : shift === 'day'
        ? 'handoffDayChecklist'
        : 'handoffNightChecklist';
  return { [`${key}.${field}`]: value } as DailyRecordPatch;
};

export const buildNovedadesPatch = (shift: 'day' | 'night', value: string): DailyRecordPatch =>
  shift === 'day' ? { handoffNovedadesDayShift: value } : { handoffNovedadesNightShift: value };

/** «Recibe»: the day shift hands over to the night nurses; the night shift to its own list. */
export const buildHandoffReceivesPatch = (
  shift: 'day' | 'night',
  staffList: string[]
): DailyRecordPatch =>
  shift === 'day' ? { nursesNightShift: staffList } : { handoffNightReceives: staffList };
