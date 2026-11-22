import { useMemo } from 'react';
import {
  useDailyRecordBeds,
  useDailyRecordStaff,
  useDailyRecordStatus,
} from '@/context/DailyRecordContext';
import { useDailyRecordDayActions } from '@/context/useDailyRecordScopedActions';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { useCensusPromptState } from '@/features/census/hooks/useCensusPromptState';

/**
 * Custom hook to manage the logic for the Census View.
 * Connects the view with DailyRecordContext and handles asynchronous checks for previous day
 * availability. Staff selectors and movement actions read their own context where they render.
 *
 * @param currentDateString - The currently selected date in YYYY-MM-DD format.
 */
export const useCensusLogic = (currentDateString: string) => {
  const beds = useDailyRecordBeds();
  const staff = useDailyRecordStaff();
  const { createDay } = useDailyRecordDayActions();

  // Only the empty-day prompt uses the copy source, and it mounts once the day is confirmed empty.
  // `!beds` alone is also true while the day is still loading, on every cold start.
  const { bootstrapPhase } = useDailyRecordStatus();
  const promptState = useCensusPromptState(
    currentDateString,
    !beds && bootstrapPhase === 'confirmed_empty'
  );

  // Calculate statistics when record changes
  const stats = useMemo(() => {
    if (!beds) return null;
    return calculateStats(beds);
  }, [beds]);

  return {
    beds,
    staff,
    stats,
    previousRecordAvailable: promptState.previousRecordAvailable,
    previousRecordDate: promptState.previousRecordDate,
    createDay,
  };
};
