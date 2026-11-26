import { useMemo } from 'react';
import type { DailyRecordStaffActions } from '@/context/dailyRecordContextContracts';
import { useDailyRecordStaff } from '@/context/DailyRecordContext';
import { useDailyRecordPersistenceActions } from '@/context/useDailyRecordScopedActions';
import {
  useDetailedStaffingManagement,
  useShiftStaffManagement,
} from '@/hooks/useShiftStaffManagement';

/**
 * Shift-staffing actions composed inside the lazy census route rather than the global shell.
 * Subscribes only to the narrow staff slice so unrelated bed/revision updates never re-render
 * `CensusStaffHeader`.
 */
export const useCensusStaffActions = (): DailyRecordStaffActions => {
  const staffData = useDailyRecordStaff();
  const { patchRecord } = useDailyRecordPersistenceActions();
  const { updateShiftStaff } = useShiftStaffManagement(staffData, patchRecord);
  const { updateDetailedStaffing } = useDetailedStaffingManagement(staffData, patchRecord);

  return useMemo(
    () => ({
      updateShiftStaff,
      updateDetailedStaffing,
    }),
    [updateDetailedStaffing, updateShiftStaff]
  );
};
