import type {
  DailyRecordStaffingDetailsV1,
  DetailedStaffingRole,
  DetailedStaffingShift,
} from '@/services/contracts/dailyRecordServiceContracts';

const STANDARD_SLOT_COUNT = {
  nurse: 2,
  tens: 3,
} as const;

export interface StandardStaffingNames {
  nursesDayShift: string[];
  nursesNightShift: string[];
  tensDayShift: string[];
  tensNightShift: string[];
}

const resolveStandardNames = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): string[] => {
  const standardSlotCount = STANDARD_SLOT_COUNT[role];
  const assignments = detail[shift][role === 'nurse' ? 'nurses' : 'tens'];
  const resolved = Array.from({ length: standardSlotCount }, () => '');

  assignments.forEach(assignment => {
    if (
      assignment.slotType === 'standard' &&
      typeof assignment.standardSlotIndex === 'number' &&
      Number.isInteger(assignment.standardSlotIndex) &&
      assignment.standardSlotIndex >= 0 &&
      assignment.standardSlotIndex < standardSlotCount
    ) {
      resolved[assignment.standardSlotIndex] = assignment.name || '';
    }
  });

  return resolved;
};

export const resolveDetailedStaffingStandardNames = (
  detail: DailyRecordStaffingDetailsV1
): StandardStaffingNames => ({
  nursesDayShift: resolveStandardNames(detail, 'day', 'nurse'),
  nursesNightShift: resolveStandardNames(detail, 'night', 'nurse'),
  tensDayShift: resolveStandardNames(detail, 'day', 'tens'),
  tensNightShift: resolveStandardNames(detail, 'night', 'tens'),
});
