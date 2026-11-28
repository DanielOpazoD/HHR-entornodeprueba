import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import {
  applyDailyRecordStaffingCompatibility,
  readStoredShiftSlots,
  resolveStoredDayShiftSlots,
  toEmptyShiftPair,
  type DailyRecordStaffingCompatShape,
} from '@/domain/staff/dailyRecordStaffingCompatibility';

export { applyDailyRecordStaffingCompatibility, resolveStoredDayShiftSlots };

type DailyRecordShiftStaffingShape = DailyRecordStaffingCompatShape;

type DailyRecordUnknownStaffingShape = Record<
  'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift',
  unknown
>;

/** Historical discovery reads all recorded spellings, without choosing an active shift. */
export const collectRecordedStaffNames = (record: Partial<DailyRecordStaffingState>) => {
  const names = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
  const nurseNames = [
    ...names(record.nurses),
    ...(typeof record.nurseName === 'string' ? [record.nurseName] : []),
    ...names(record.nursesDayShift),
    ...names(record.nursesNightShift),
    ...names(record.handoffNightReceives),
  ];
  const tensNames = [...names(record.tensDayShift), ...names(record.tensNightShift)];
  for (const shift of ['day', 'night'] as const) {
    const detail = record.staffingDetailsV1?.[shift];
    if (Array.isArray(detail?.nurses))
      nurseNames.push(...detail.nurses.map(person => person?.name));
    if (Array.isArray(detail?.tens)) tensNames.push(...detail.tens.map(person => person?.name));
  }
  return { nurseNames, tensNames };
};

const normalizeStaffList = (staff?: string[] | null): string[] =>
  Array.isArray(staff) ? staff.map(value => value?.trim() || '').filter(Boolean) : [];

const resolveLegacyDayShiftNurses = (record: DailyRecordShiftStaffingShape): string[] => {
  const legacy = normalizeStaffList(record.nurses);
  if (legacy.length > 0) {
    return legacy;
  }

  return record.nurseName?.trim() ? [record.nurseName.trim()] : [];
};

export const resolveDayShiftNurses = (
  record: DailyRecordShiftStaffingShape | null | undefined
): string[] => {
  if (!record) return [];
  const canonical = normalizeStaffList(record.nursesDayShift);
  return canonical.length > 0 ? canonical : resolveLegacyDayShiftNurses(record);
};

export const resolveNightShiftNurses = (
  record: DailyRecordShiftStaffingShape | null | undefined
): string[] => {
  if (!record) return [];
  return normalizeStaffList(record.nursesNightShift);
};

export const buildCompatibleDayShiftStaffingMirror = (
  staff: string[] | null | undefined
): Pick<DailyRecordStaffingCompatShape, 'nurses' | 'nursesDayShift'> => {
  const resolvedDayShift = toEmptyShiftPair(readStoredShiftSlots(staff));
  return {
    nurses: [...resolvedDayShift],
    nursesDayShift: [...resolvedDayShift],
  };
};

export const normalizeUnknownDailyRecordStaffing = (
  record: Partial<DailyRecordUnknownStaffingShape>,
  ensurePair: (value: unknown) => string[]
): DailyRecordStaffingCompatShape =>
  applyDailyRecordStaffingCompatibility({
    nurses: ensurePair(record.nurses),
    nurseName: typeof record.nurseName === 'string' ? record.nurseName : undefined,
    nursesDayShift: ensurePair(record.nursesDayShift),
    nursesNightShift: ensurePair(record.nursesNightShift),
  });

export const hasLegacyDayShiftNurses = (
  record: DailyRecordShiftStaffingShape | null | undefined
): boolean => {
  if (!record) return false;
  return normalizeStaffList(record.nurses).length > 0;
};

export const hasLegacyPrimaryDayShiftNurse = (
  record: DailyRecordShiftStaffingShape | null | undefined
): boolean => {
  if (!record) return false;
  return Boolean(record.nurseName?.trim());
};

export const resolveShiftNurseSignature = (
  record: DailyRecordShiftStaffingShape | null | undefined,
  preferredShift: 'day' | 'night' = 'night'
): string => {
  if (!record) return '';
  const preferred =
    preferredShift === 'night' ? resolveNightShiftNurses(record) : resolveDayShiftNurses(record);
  if (preferred.length > 0) {
    return preferred.join(' / ');
  }

  const fallback =
    preferredShift === 'night' ? resolveDayShiftNurses(record) : resolveNightShiftNurses(record);
  return fallback.join(' / ');
};

export const resolveHandoffShiftStaff = (
  record:
    | Pick<
        DailyRecordStaffingState,
        'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift' | 'handoffNightReceives'
      >
    | null
    | undefined,
  shift: 'day' | 'night'
): { delivers: string[]; receives: string[] } => {
  if (!record) {
    return {
      delivers: [],
      receives: [],
    };
  }

  return {
    delivers: shift === 'day' ? resolveDayShiftNurses(record) : resolveNightShiftNurses(record),
    receives:
      shift === 'day'
        ? resolveNightShiftNurses(record)
        : normalizeStaffList(record.handoffNightReceives),
  };
};
