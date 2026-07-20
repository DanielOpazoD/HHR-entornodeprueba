import { getShiftSchedule } from '@/utils/clinicalDayUtils';
import type {
  DailyRecordPatch,
  DailyRecordStaffingDetailsV1,
  DetailedStaffAssignment,
  DetailedStaffingRole,
  DetailedStaffingShift,
} from '@/services/contracts/dailyRecordServiceContracts';

const STANDARD_SLOT_COUNT = {
  nurse: 2,
  tens: 3,
} as const;

type DailyRecordDetailedStaffingShape = {
  date?: string;
  nursesDayShift?: string[] | null;
  nursesNightShift?: string[] | null;
  tensDayShift?: string[] | null;
  tensNightShift?: string[] | null;
  staffingDetailsV1?: DailyRecordStaffingDetailsV1;
};

export interface ShiftRoleStaffingMeta {
  extraCount: number;
  hasSpecialSchedule: boolean;
}

const ensureStringArray = (value?: string[] | null, expectedLength = 0): string[] => {
  const safeValue = Array.isArray(value) ? value.map(item => item || '') : [];
  while (safeValue.length < expectedLength) {
    safeValue.push('');
  }
  return safeValue.slice(0, Math.max(expectedLength, safeValue.length));
};

const getRoleCollectionKey = (role: DetailedStaffingRole): 'nurses' | 'tens' =>
  role === 'nurse' ? 'nurses' : 'tens';
export const getDetailedShiftRoleAssignments = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): DetailedStaffAssignment[] => detail[shift][getRoleCollectionKey(role)];
const getExistingShiftRoleAssignments = (
  detail: DailyRecordStaffingDetailsV1 | undefined,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): DetailedStaffAssignment[] | undefined => detail?.[shift][getRoleCollectionKey(role)];
const getStandardSchedule = (date: string, shift: DetailedStaffingShift) =>
  shift === 'day'
    ? { startTime: getShiftSchedule(date).dayStart, endTime: getShiftSchedule(date).dayEnd }
    : { startTime: getShiftSchedule(date).nightStart, endTime: getShiftSchedule(date).nightEnd };

const createStandardAssignment = (
  date: string,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  standardSlotIndex: number
): DetailedStaffAssignment => {
  const { startTime, endTime } = getStandardSchedule(date, shift);
  return {
    id: `${shift}-${role}-standard-${standardSlotIndex}`,
    name: '',
    role,
    slotType: 'standard',
    standardSlotIndex,
    startTime,
    endTime,
  };
};
const cloneAssignment = (assignment: DetailedStaffAssignment): DetailedStaffAssignment => ({
  ...assignment,
});
const sortAssignments = (assignments: DetailedStaffAssignment[]): DetailedStaffAssignment[] =>
  [...assignments].sort((left, right) => {
    const leftIndex = left.standardSlotIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.standardSlotIndex ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
const normalizeRoleAssignments = ({
  date,
  shift,
  role,
  legacyNames,
  assignments,
}: {
  date: string;
  shift: DetailedStaffingShift;
  role: DetailedStaffingRole;
  legacyNames: string[];
  assignments?: DetailedStaffAssignment[];
}): DetailedStaffAssignment[] => {
  const standardSlotCount = STANDARD_SLOT_COUNT[role];
  const standardAssignments = Array.from({ length: standardSlotCount }, (_, index) => {
    const base = createStandardAssignment(date, shift, role, index);
    base.name = legacyNames[index] || '';
    return base;
  });
  const extras: DetailedStaffAssignment[] = [];

  assignments?.forEach(assignment => {
    const normalizedAssignment: DetailedStaffAssignment = {
      ...cloneAssignment(assignment),
      id:
        assignment.id ||
        (assignment.slotType === 'standard'
          ? `${shift}-${role}-standard-${assignment.standardSlotIndex ?? 0}`
          : `${shift}-${role}-extra-${extras.length}`),
      role,
      slotType: assignment.slotType === 'extra' ? 'extra' : 'standard',
      startTime: assignment.startTime || getStandardSchedule(date, shift).startTime,
      endTime: assignment.endTime || getStandardSchedule(date, shift).endTime,
    };

    if (
      normalizedAssignment.slotType === 'standard' &&
      typeof normalizedAssignment.standardSlotIndex === 'number' &&
      normalizedAssignment.standardSlotIndex >= 0 &&
      normalizedAssignment.standardSlotIndex < standardAssignments.length
    ) {
      const target = standardAssignments[normalizedAssignment.standardSlotIndex];
      standardAssignments[normalizedAssignment.standardSlotIndex] = {
        ...target,
        ...normalizedAssignment,
        id: normalizedAssignment.id,
        name: normalizedAssignment.name || target.name,
        standardSlotIndex: normalizedAssignment.standardSlotIndex,
      };
      return;
    }

    extras.push({
      ...normalizedAssignment,
      id: normalizedAssignment.id || `${shift}-${role}-extra-${extras.length}`,
      slotType: 'extra',
      standardSlotIndex: undefined,
    });
  });

  return [...sortAssignments(standardAssignments), ...extras];
};

export const createEmptyDetailedStaffing = (date: string): DailyRecordStaffingDetailsV1 => ({
  day: {
    nurses: normalizeRoleAssignments({
      date,
      shift: 'day',
      role: 'nurse',
      legacyNames: ['', ''],
    }),
    tens: normalizeRoleAssignments({
      date,
      shift: 'day',
      role: 'tens',
      legacyNames: ['', '', ''],
    }),
  },
  night: {
    nurses: normalizeRoleAssignments({
      date,
      shift: 'night',
      role: 'nurse',
      legacyNames: ['', ''],
    }),
    tens: normalizeRoleAssignments({
      date,
      shift: 'night',
      role: 'tens',
      legacyNames: ['', '', ''],
    }),
  },
});

export const resolveDetailedStaffingState = (
  record: DailyRecordDetailedStaffingShape | null | undefined,
  fallbackDate?: string
): DailyRecordStaffingDetailsV1 => {
  const date = record?.date || fallbackDate;
  if (!date) {
    throw new Error('resolveDetailedStaffingState requires a date');
  }

  return {
    day: {
      nurses: normalizeRoleAssignments({
        date,
        shift: 'day',
        role: 'nurse',
        legacyNames: ensureStringArray(record?.nursesDayShift, STANDARD_SLOT_COUNT.nurse),
        assignments: getExistingShiftRoleAssignments(record?.staffingDetailsV1, 'day', 'nurse'),
      }),
      tens: normalizeRoleAssignments({
        date,
        shift: 'day',
        role: 'tens',
        legacyNames: ensureStringArray(record?.tensDayShift, STANDARD_SLOT_COUNT.tens),
        assignments: record?.staffingDetailsV1?.day?.tens,
      }),
    },
    night: {
      nurses: normalizeRoleAssignments({
        date,
        shift: 'night',
        role: 'nurse',
        legacyNames: ensureStringArray(record?.nursesNightShift, STANDARD_SLOT_COUNT.nurse),
        assignments: getExistingShiftRoleAssignments(record?.staffingDetailsV1, 'night', 'nurse'),
      }),
      tens: normalizeRoleAssignments({
        date,
        shift: 'night',
        role: 'tens',
        legacyNames: ensureStringArray(record?.tensNightShift, STANDARD_SLOT_COUNT.tens),
        assignments: record?.staffingDetailsV1?.night?.tens,
      }),
    },
  };
};

const cloneDetail = (detail: DailyRecordStaffingDetailsV1): DailyRecordStaffingDetailsV1 => ({
  day: {
    nurses: getDetailedShiftRoleAssignments(detail, 'day', 'nurse').map(cloneAssignment),
    tens: getDetailedShiftRoleAssignments(detail, 'day', 'tens').map(cloneAssignment),
  },
  night: {
    nurses: getDetailedShiftRoleAssignments(detail, 'night', 'nurse').map(cloneAssignment),
    tens: getDetailedShiftRoleAssignments(detail, 'night', 'tens').map(cloneAssignment),
  },
});

const withUpdatedShiftRoleAssignments = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  updater: (assignments: DetailedStaffAssignment[]) => DetailedStaffAssignment[]
): DailyRecordStaffingDetailsV1 => {
  const nextDetail = cloneDetail(detail);
  const collectionKey = getRoleCollectionKey(role);
  nextDetail[shift][collectionKey] = updater(nextDetail[shift][collectionKey]);
  return nextDetail;
};

const resolveStandardNames = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): string[] => {
  const standardSlotCount = STANDARD_SLOT_COUNT[role];
  const collectionKey = getRoleCollectionKey(role);
  const resolved = Array.from({ length: standardSlotCount }, () => '');

  detail[shift][collectionKey].forEach(assignment => {
    if (
      assignment.slotType === 'standard' &&
      typeof assignment.standardSlotIndex === 'number' &&
      assignment.standardSlotIndex >= 0 &&
      assignment.standardSlotIndex < standardSlotCount
    ) {
      resolved[assignment.standardSlotIndex] = assignment.name || '';
    }
  });

  return resolved;
};

export const buildDetailedStaffingPatch = (
  detail: DailyRecordStaffingDetailsV1
): DailyRecordPatch => {
  const nursesDayShift = resolveStandardNames(detail, 'day', 'nurse');
  const nursesNightShift = resolveStandardNames(detail, 'night', 'nurse');
  const tensDayShift = resolveStandardNames(detail, 'day', 'tens');
  const tensNightShift = resolveStandardNames(detail, 'night', 'tens');

  return {
    nurses: [...nursesDayShift],
    nursesDayShift,
    nursesNightShift,
    tensDayShift,
    tensNightShift,
    staffingDetailsV1: cloneDetail(detail),
  };
};

export const resolveShiftRoleStaffingMeta = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): ShiftRoleStaffingMeta => {
  const collectionKey = getRoleCollectionKey(role);
  const assignments = detail[shift][collectionKey];
  const standardSchedule = assignments.find(assignment => assignment.slotType === 'standard');

  return {
    extraCount: assignments.filter(assignment => assignment.slotType === 'extra').length,
    hasSpecialSchedule: assignments.some(assignment => {
      if (assignment.slotType !== 'standard' && !assignment.name.trim()) {
        return false;
      }

      if (!standardSchedule) {
        return false;
      }

      return (
        assignment.startTime !== standardSchedule.startTime ||
        assignment.endTime !== standardSchedule.endTime
      );
    }),
  };
};

export const updateDetailedStaffingStandardSlot = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  index: number,
  name: string
): DailyRecordStaffingDetailsV1 =>
  withUpdatedShiftRoleAssignments(detail, shift, role, assignments =>
    assignments.map(assignment => {
      if (assignment.slotType !== 'standard' || assignment.standardSlotIndex !== index) {
        return assignment;
      }

      return {
        ...assignment,
        name,
      };
    })
  );

export const updateDetailedStaffingAssignment = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  assignmentId: string,
  updates: Partial<Pick<DetailedStaffAssignment, 'name' | 'startTime' | 'endTime'>>
): DailyRecordStaffingDetailsV1 =>
  withUpdatedShiftRoleAssignments(detail, shift, role, assignments =>
    assignments.map(assignment =>
      assignment.id === assignmentId ? { ...assignment, ...updates } : assignment
    )
  );

export const addDetailedStaffingExtra = (
  detail: DailyRecordStaffingDetailsV1,
  date: string,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole
): DailyRecordStaffingDetailsV1 => {
  const { startTime, endTime } = getStandardSchedule(date, shift);

  return withUpdatedShiftRoleAssignments(detail, shift, role, assignments => [
    ...assignments,
    {
      id: `${shift}-${role}-extra-${Date.now()}`,
      name: '',
      role,
      slotType: 'extra',
      startTime,
      endTime,
    },
  ]);
};

export const removeDetailedStaffingExtra = (
  detail: DailyRecordStaffingDetailsV1,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  assignmentId: string
): DailyRecordStaffingDetailsV1 =>
  withUpdatedShiftRoleAssignments(detail, shift, role, assignments =>
    assignments.filter(assignment => assignment.id !== assignmentId)
  );

export const resetDetailedStaffingAssignmentToStandard = (
  detail: DailyRecordStaffingDetailsV1,
  date: string,
  shift: DetailedStaffingShift,
  role: DetailedStaffingRole,
  assignmentId: string
): DailyRecordStaffingDetailsV1 => {
  const { startTime, endTime } = getStandardSchedule(date, shift);

  return withUpdatedShiftRoleAssignments(detail, shift, role, assignments =>
    assignments.map(assignment =>
      assignment.id === assignmentId
        ? {
            ...assignment,
            startTime,
            endTime,
          }
        : assignment
    )
  );
};
