import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import { normalizeStaffSlots } from '@/domain/staff/dailyRecordStaffingCompatibility';
import {
  getDetailedShiftRoleAssignments,
  resolveDetailedStaffingState,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { resolveDayShiftNurseSlots } from '@/services/staff/dailyRecordStaffing';
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

const resolveDetailedShiftNurseSlots = (
  record: DailyRecordExportPresentationShape | null | undefined,
  shift: 'day' | 'night'
): string[] | null => {
  if (!record?.staffingDetailsV1 || !record.date) return null;

  const detailedStaffingState = resolveDetailedStaffingState(record, record.date);
  return getDetailedShiftRoleAssignments(detailedStaffingState, shift, 'nurse')
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

  return presentStaffSelectionsForExport(
    resolveDayShiftNurseSlots(record, STANDARD_NURSE_SLOT_COUNT)
  );
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
