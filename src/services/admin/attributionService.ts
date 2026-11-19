import { isInstitutionalAccount } from '@/constants/identities';
import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import {
  resolveDayShiftNurses,
  resolveNightShiftNurses,
} from '@/services/staff/dailyRecordStaffing';
import { getCurrentShift } from '@/utils/clinicalDayUtils';

/**
 * Service to handle nurse attribution logic for shared accounts.
 * Primarily used to comply with MINSAL requirements for individual responsibility
 * when using institutional shared emails.
 */

/**
 * Determines if a user represents a shared nursing account
 * @param userId User email or ID
 */
export const isSharedNursingAccount = (userId: string | undefined): boolean => {
  if (!userId) return false;
  // We check both primary and alternative for backward compatibility during transition
  return isInstitutionalAccount(userId);
};

/**
 * Extracts the names of nurses assigned to a specific shift from a daily record.
 */
export const getNurseAuthors = (
  record: DailyRecordStaffingState | null | undefined,
  shift?: 'day' | 'night'
): string | undefined => {
  if (!record) return undefined;

  const targetShift = shift || getCurrentShift();
  const nurses =
    targetShift === 'day' ? resolveDayShiftNurses(record) : resolveNightShiftNurses(record);

  if (!nurses || nurses.length === 0) return undefined;

  // Filter out empty or whitespace-only names
  const validNurses = nurses.filter(n => n && n.trim().length > 0);

  return validNurses.length > 0 ? validNurses.join(', ') : undefined;
};

/**
 * Full attribution logic: checks if account is shared and returns authors if so.
 */
export const getAttributedAuthors = (
  userId: string | undefined,
  record: DailyRecordStaffingState | null | undefined,
  shift?: 'day' | 'night'
): string | undefined => {
  if (!isSharedNursingAccount(userId)) return undefined;
  return getNurseAuthors(record, shift);
};
