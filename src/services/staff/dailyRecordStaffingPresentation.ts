import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import { normalizeStaffSlots } from '@/domain/staff/dailyRecordStaffingCompatibility';
import { resolveDetailedStaffingState } from '@/services/staff/dailyRecordDetailedStaffing';
import { normalizeStaffSelectionValue } from '@/services/staff/staffSelectionPresentation';

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

const presentStaffSelectionsForExport = (staff: string[]): string[] =>
  staff.map(value => normalizeStaffSelectionValue(value));

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

export const resolveExportableNursesText = (
  record: DailyRecordExportPresentationShape | null | undefined,
  separator = ' & '
): string => resolvePresentedDayShiftNurses(record).join(separator);
