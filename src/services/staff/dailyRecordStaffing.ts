import type { DailyRecordStaffingState } from '@/services/contracts/dailyRecordServiceContracts';
import { resolveDetailedStaffingState } from '@/services/staff/dailyRecordDetailedStaffing';
import { normalizeStaffSelectionValue } from '@/services/staff/staffSelectionPresentation';

type DailyRecordStaffingCompatShape = Pick<
  DailyRecordStaffingState,
  'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'
>;

type DailyRecordShiftStaffingShape = Pick<
  DailyRecordStaffingState,
  'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'
>;

type DailyRecordUnknownStaffingShape = Record<
  'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift',
  unknown
>;

type DailyRecordExportPresentationShape = Partial<
  Pick<
    DailyRecordStaffingState,
    | 'date'
    | 'nurses'
    | 'nurseName'
    | 'nursesDayShift'
    | 'nursesNightShift'
    | 'staffingDetailsV1'
    | 'handoffNightReceives'
  >
>;

const STANDARD_NURSE_SLOT_COUNT = 2;

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

const normalizeStaffSlots = (staff?: string[] | null, slotCount = 0): string[] => {
  const normalized = Array.isArray(staff) ? staff.map(value => value?.trim() || '') : [];
  while (normalized.length < slotCount) normalized.push('');
  return normalized.slice(0, slotCount || normalized.length);
};

const presentStaffSelectionsForExport = (staff: string[]): string[] =>
  staff.map(value => normalizeStaffSelectionValue(value));

const toEmptyShiftPair = (staff: string[]): string[] => (staff.length > 0 ? staff : ['', '']);

const resolveLegacyDayShiftNurses = (record: DailyRecordShiftStaffingShape): string[] => {
  const legacy = normalizeStaffList(record.nurses);
  if (legacy.length > 0) {
    return legacy;
  }

  return record.nurseName?.trim() ? [record.nurseName.trim()] : [];
};

const resolveLegacyDayShiftNurseSlots = (
  record: Pick<DailyRecordExportPresentationShape, 'nurses' | 'nurseName'>
): string[] => {
  const legacy = normalizeStaffSlots(record.nurses, STANDARD_NURSE_SLOT_COUNT);
  if (legacy.some(Boolean)) {
    return legacy;
  }

  return record.nurseName?.trim() ? [record.nurseName.trim(), ''] : ['', ''];
};

const resolveDetailedShiftNurseSlots = (
  record: DailyRecordExportPresentationShape | null | undefined,
  shift: 'day' | 'night'
): string[] | null => {
  if (!record?.staffingDetailsV1 || !record.date) return null;

  const detailedStaffingState = resolveDetailedStaffingState(record, record.date);
  return detailedStaffingState[shift].nurses
    .slice(0, STANDARD_NURSE_SLOT_COUNT)
    .map(assignment => assignment.name?.trim() || '');
};

export const resolvePresentedDayShiftNurses = (
  record: DailyRecordExportPresentationShape | null | undefined
): string[] => {
  if (!record) return [];

  const detailed = resolveDetailedShiftNurseSlots(record, 'day');
  if (detailed) {
    return presentStaffSelectionsForExport(detailed);
  }

  const canonical = normalizeStaffSlots(record.nursesDayShift, STANDARD_NURSE_SLOT_COUNT);
  return canonical.some(Boolean)
    ? presentStaffSelectionsForExport(canonical)
    : presentStaffSelectionsForExport(resolveLegacyDayShiftNurseSlots(record));
};

export const resolvePresentedNightShiftNurses = (
  record: DailyRecordExportPresentationShape | null | undefined
): string[] => {
  if (!record) return [];

  const detailed = resolveDetailedShiftNurseSlots(record, 'night');
  if (detailed) {
    return presentStaffSelectionsForExport(detailed);
  }

  return presentStaffSelectionsForExport(
    normalizeStaffSlots(record.nursesNightShift, STANDARD_NURSE_SLOT_COUNT)
  );
};

export const resolvePresentedNightHandoffReceives = (
  record: Pick<DailyRecordExportPresentationShape, 'handoffNightReceives'> | null | undefined
): string[] => {
  if (!record) return [];

  return presentStaffSelectionsForExport(
    normalizeStaffSlots(record.handoffNightReceives, STANDARD_NURSE_SLOT_COUNT)
  );
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

export const applyDailyRecordStaffingCompatibility = <T extends DailyRecordStaffingCompatShape>(
  record: T
): T => {
  const compatRecord = record as unknown as DailyRecordStaffingCompatShape;
  const resolvedDayShift = toEmptyShiftPair(resolveDayShiftNurses(compatRecord));
  const resolvedNightShift = toEmptyShiftPair(resolveNightShiftNurses(compatRecord));

  return {
    ...record,
    // Legacy `nurses` is kept only as a compatibility mirror of the canonical day shift field.
    nurses: [...resolvedDayShift],
    nursesDayShift: [...resolvedDayShift],
    nursesNightShift: [...resolvedNightShift],
  };
};

export const buildCompatibleDayShiftStaffingMirror = (
  staff: string[] | null | undefined
): Pick<DailyRecordStaffingCompatShape, 'nurses' | 'nursesDayShift'> => {
  const resolvedDayShift = toEmptyShiftPair(normalizeStaffList(staff));
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

export const resolvePrimaryDayShiftNurse = (
  record: DailyRecordShiftStaffingShape | null | undefined
): string | undefined => resolveDayShiftNurses(record)[0];

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

export const resolveExportableNursesText = (
  record: DailyRecordExportPresentationShape | null | undefined,
  separator = ' & '
): string => resolvePresentedDayShiftNurses(record).join(separator);

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
