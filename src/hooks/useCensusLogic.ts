import { useMemo } from 'react';
import {
  useDailyRecordBeds,
  useDailyRecordMovements,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import {
  useDailyRecordDayActions,
  useDailyRecordMovementActions,
  useDailyRecordStaffActions,
} from '@/context/useDailyRecordScopedActions';
import { useStaffContext } from '@/context/StaffContext';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { useCensusPromptState } from '@/hooks/useCensusPromptState';

/**
 * Custom hook to manage the logic for the Census View.
 * Connects the view with DailyRecordContext and StaffContext,
 * and handles asynchronous checks for previous day availability.
 *
 * @param currentDateString - The currently selected date in YYYY-MM-DD format.
 */
export const useCensusLogic = (currentDateString: string) => {
  const beds = useDailyRecordBeds();
  const movements = useDailyRecordMovements();
  const staff = useDailyRecordStaff();
  const { createDay, resetDay } = useDailyRecordDayActions();
  const { updateNurse, updateTens } = useDailyRecordStaffActions();
  const { undoDischarge, deleteDischarge, undoTransfer, deleteTransfer } =
    useDailyRecordMovementActions();

  const { nursesList, tensList } = useStaffContext();

  // Copy-source dates are only consumed by the empty-day prompt.
  const promptState = useCensusPromptState(currentDateString, !beds);

  // Calculate statistics when record changes
  const stats = useMemo(() => {
    if (!beds) return null;
    return calculateStats(beds);
  }, [beds]);

  return {
    // Data
    beds,
    movements,
    staff,
    nursesList,
    tensList,
    stats,
    previousRecordAvailable: promptState.previousRecordAvailable,
    previousRecordDate: promptState.previousRecordDate,
    availableDates: promptState.availableDates,

    // Actions
    createDay,
    resetDay,
    updateNurse,
    updateTens,
    undoDischarge,
    deleteDischarge,
    undoTransfer,
    deleteTransfer,
  };
};
