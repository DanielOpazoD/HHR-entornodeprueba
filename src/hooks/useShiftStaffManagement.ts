import { useMemo, useCallback } from 'react';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { useLatestRef } from '@/hooks/useLatestRef';
import type {
  DailyRecordStaffingDetailsV1,
  DetailedStaffingRole,
  DetailedStaffingShift,
} from '@/types/domain/dailyRecordStaffingDetails';
import {
  buildDetailedStaffingPatch,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

export interface ShiftStaffingRecordSlice {
  date?: string;
  nursesDayShift?: string[] | null;
  nursesNightShift?: string[] | null;
  tensDayShift?: string[] | null;
  tensNightShift?: string[] | null;
  staffingDetailsV1?: DailyRecordStaffingDetailsV1;
}

/**
 * A select has nobody to answer to. patchRecord already told the user and logged a refused write,
 * and the select shows the stored name again, ready to retry.
 */
const settleStaffSelection = (write: Promise<void>): void => {
  void Promise.resolve(write).catch(() => {});
};

export const useShiftStaffManagement = (
  record: ShiftStaffingRecordSlice | null,
  patchRecord: ApplyDailyRecordPatch
) => {
  const recordRef = useLatestRef(record);

  const updateShiftStaff = useCallback(
    (role: DetailedStaffingRole, shift: DetailedStaffingShift, index: number, name: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord || !currentRecord.date) return;

      const detail = resolveDetailedStaffingState(currentRecord, currentRecord.date);
      const updatedDetail = updateDetailedStaffingStandardSlot(detail, shift, role, index, name);
      settleStaffSelection(patchRecord(buildDetailedStaffingPatch(updatedDetail)));
    },
    [patchRecord, recordRef]
  );

  return useMemo(
    () => ({
      updateShiftStaff,
    }),
    [updateShiftStaff]
  );
};

export const useDetailedStaffingManagement = (
  record: ShiftStaffingRecordSlice | null,
  patchRecord: ApplyDailyRecordPatch
) => {
  const recordRef = useLatestRef(record);

  const updateDetailedStaffing = useCallback(
    async (detail: DailyRecordStaffingDetailsV1) => {
      if (!recordRef.current) return;
      await patchRecord(buildDetailedStaffingPatch(detail));
    },
    [patchRecord, recordRef]
  );

  return useMemo(
    () => ({
      updateDetailedStaffing,
    }),
    [updateDetailedStaffing]
  );
};
