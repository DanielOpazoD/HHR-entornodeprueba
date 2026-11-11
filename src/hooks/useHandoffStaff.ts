import { useMemo } from 'react';
import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import { resolveHandoffShiftStaff } from '@/services/staff/dailyRecordStaffing';

export type NursingShift = 'day' | 'night';

/**
 * useHandoffStaff Hook
 *
 * Manages staff lists (delivering, receiving, TENS) derived from the DailyRecord.
 */
export const useHandoffStaff = (
  record: DailyRecordStaffingState | null,
  selectedShift: NursingShift
) => {
  const deliversList = useMemo(() => {
    return resolveHandoffShiftStaff(record, selectedShift).delivers;
  }, [record, selectedShift]);

  const receivesList = useMemo(() => {
    return resolveHandoffShiftStaff(record, selectedShift).receives;
  }, [record, selectedShift]);

  const tensList = useMemo(() => {
    if (!record) return [];
    return selectedShift === 'day' ? record.tensDayShift || [] : record.tensNightShift || [];
  }, [record, selectedShift]);

  return {
    deliversList,
    receivesList,
    tensList,
  };
};
