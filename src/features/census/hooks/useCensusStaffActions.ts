import { useMemo } from 'react';
import type { DailyRecordStaffActions } from '@/context/dailyRecordContextContracts';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordPersistenceActions } from '@/context/useDailyRecordScopedActions';
import {
  useDetailedStaffingManagement,
  useShiftStaffManagement,
} from '@/hooks/useShiftStaffManagement';

/**
 * Shift-staffing actions composed inside the lazy census route rather than the global shell.
 */
export const useCensusStaffActions = (): DailyRecordStaffActions => {
  const { record } = useDailyRecordData();
  const { patchRecord } = useDailyRecordPersistenceActions();
  const { updateShiftStaff } = useShiftStaffManagement(record, patchRecord);
  const { updateDetailedStaffing } = useDetailedStaffingManagement(record, patchRecord);

  return useMemo(
    () => ({
      updateShiftStaff,
      updateDetailedStaffing,
    }),
    [updateDetailedStaffing, updateShiftStaff]
  );
};
