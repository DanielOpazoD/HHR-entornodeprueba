import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';
import { dailyRecordFieldSet } from '@/services/repositories/conflictResolutionUtils';
import {
  buildCompatibleDayShiftStaffingMirror,
  resolveDayShiftNurses,
} from '@/services/staff/dailyRecordStaffing';

const isVacantStaffingSlot = (value: string | null | undefined): boolean => {
  const normalized = String(value ?? '').trim();
  return normalized === '' || normalized === '--' || normalized === 'Vacante';
};

export const STAFFING_SLOT_ARRAY_FIELDS = dailyRecordFieldSet([
  'nursesNightShift',
  'tensDayShift',
  'tensNightShift',
]);

export const mergeFixedStaffingSlots = (
  remote: string[] = [],
  local: string[] = [],
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  path = '',
  preservePreferredVacancies = false
): string[] => {
  const preferred = preferLocal ? local : remote;
  const secondary = preferLocal ? remote : local;
  const length = Math.max(preferred.length, secondary.length);

  traceContext?.add({
    path,
    strategy: 'merge_fixed_staffing_slots',
    winner: 'merged',
    reason: preservePreferredVacancies
      ? 'staffing_slots_preserve_explicit_preferred_vacancies'
      : preferLocal
        ? 'staffing_slots_prefer_local_fill_vacancies'
        : 'staffing_slots_prefer_remote_fill_vacancies',
  });

  return Array.from({ length }, (_, index) => {
    const preferredValue = preferred[index] ?? '';
    const secondaryValue = secondary[index] ?? '';
    if (preservePreferredVacancies || !isVacantStaffingSlot(preferredValue)) {
      return preferredValue;
    }
    return isVacantStaffingSlot(secondaryValue) ? preferredValue : secondaryValue;
  });
};

export const resolveCanonicalDayShiftNurses = (
  remote: DailyRecord,
  local: DailyRecord,
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  preservePreferredVacancies = false
): string[] =>
  mergeFixedStaffingSlots(
    resolveDayShiftNurses(remote),
    resolveDayShiftNurses(local),
    preferLocal,
    traceContext,
    'nursesDayShift',
    preservePreferredVacancies
  );

export const resolveStaffingSlotArray = (
  remote: DailyRecord,
  local: DailyRecord,
  root: 'nursesNightShift' | 'tensDayShift' | 'tensNightShift',
  preferLocal: boolean,
  traceContext: ConflictResolutionTraceContext,
  preservePreferredVacancies = false
): string[] => {
  return mergeFixedStaffingSlots(
    remote[root] || [],
    local[root] || [],
    preferLocal,
    traceContext,
    root,
    preservePreferredVacancies
  );
};

export const buildMergedDayShiftStaffingMirror = (
  remote: DailyRecord,
  local: DailyRecord,
  traceContext: ConflictResolutionTraceContext
): Pick<DailyRecord, 'nurses' | 'nursesDayShift'> => {
  const mergedDayShift = resolveCanonicalDayShiftNurses(remote, local, true, traceContext, true);
  return buildCompatibleDayShiftStaffingMirror(mergedDayShift);
};
