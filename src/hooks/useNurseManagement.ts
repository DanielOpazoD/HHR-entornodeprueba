import { useMemo, useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { DailyRecordStaffingDetailsV1 } from '@/application/shared/dailyRecordStaffContracts';
import {
  buildDetailedStaffingPatch,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

/**
 * A select has nobody to answer to. patchRecord already told the user and logged a refused write,
 * and the select shows the stored name again, ready to retry.
 */
const settleStaffSelection = (write: Promise<void>): void => {
  void Promise.resolve(write).catch(() => {});
};

export const useNurseManagement = (
  record: DailyRecord | null,
  patchRecord: ApplyDailyRecordPatch
) => {
  const recordRef = useLatestRef(record);

  const updateNurse = useCallback(
    (shift: 'day' | 'night', index: number, name: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const detail = resolveDetailedStaffingState(currentRecord, currentRecord.date);
      const updatedDetail = updateDetailedStaffingStandardSlot(detail, shift, 'nurse', index, name);
      settleStaffSelection(patchRecord(buildDetailedStaffingPatch(updatedDetail)));
    },
    [patchRecord, recordRef]
  );

  return useMemo(
    () => ({
      updateNurse,
    }),
    [updateNurse]
  );
};

export const useTensManagement = (
  record: DailyRecord | null,
  patchRecord: ApplyDailyRecordPatch
) => {
  const recordRef = useLatestRef(record);

  const updateTens = useCallback(
    (shift: 'day' | 'night', index: number, name: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const detail = resolveDetailedStaffingState(currentRecord, currentRecord.date);
      const updatedDetail = updateDetailedStaffingStandardSlot(detail, shift, 'tens', index, name);
      settleStaffSelection(patchRecord(buildDetailedStaffingPatch(updatedDetail)));
    },
    [patchRecord, recordRef]
  );

  return useMemo(
    () => ({
      updateTens,
    }),
    [updateTens]
  );
};

export const useDetailedStaffingManagement = (
  record: DailyRecord | null,
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
