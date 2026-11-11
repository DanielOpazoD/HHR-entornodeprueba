import { useCallback, useMemo } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { BEDS } from '@/constants/beds';
import { isAdmittedDuringShift } from '@/utils/clinicalDayUtils';
import {
  getVisibleHandoffBeds,
  hasVisibleHandoffPatients,
  shouldShowHandoffPatient,
} from '@/hooks/controllers/handoffVisibilityController';

export type NursingShift = 'day' | 'night';

/**
 * useHandoffVisibility Hook
 *
 * Handles filtering and visibility of patients and beds based on the current shift.
 */
export const useHandoffVisibility = (record: DailyRecord | null, selectedShift: NursingShift) => {
  /**
   * Determines if a bed should be visible (ignores extra beds if they are not active)
   */
  const visibleBeds = useMemo(() => {
    return getVisibleHandoffBeds(record, BEDS);
  }, [record]);

  /**
   * Determines if a patient in a bed should be shown in the current shift
   */
  const shouldShowPatient = useCallback(
    (bedId: string): boolean => {
      return shouldShowHandoffPatient(record, bedId, selectedShift, isAdmittedDuringShift);
    },
    [record, selectedShift]
  );

  /**
   * Checks if there are any patients to show in the current view
   */
  const hasAnyPatients = useMemo(() => {
    return hasVisibleHandoffPatients(record, visibleBeds, shouldShowPatient);
  }, [visibleBeds, record, shouldShowPatient]);

  return {
    visibleBeds,
    shouldShowPatient,
    hasAnyPatients,
  };
};
