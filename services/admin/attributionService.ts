import { isWorkingDay } from './calendarService';
import { INSTITUTIONAL_ACCOUNTS, isInstitutionalAccount } from '../../constants/identities';
import { DailyRecord } from '../../types';

/**
 * Service to handle nurse attribution logic for shared accounts.
 * Primarily used to comply with MINSAL requirements for individual responsibility
 * when using institutional shared emails.
 */

/**
 * Shared nursing account email that requires attribution
 */
export const SHARED_NURSING_ACCOUNT = INSTITUTIONAL_ACCOUNTS.NURSING;

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
 * Determines the current shift based on the hour of the day and whether it's a working day.
 * 
 * Rules:
 * - Working Days (Hábiles): Day (08:00-20:00), Night (20:00-08:00 next day)
 * - Non-working Days (Inhábiles): Day (09:00-20:00), Night (20:00-09:00 next day)
 * 
 * @param date Optional date to check (defaults to now)
 */
export const getCurrentShift = (date: Date = new Date()): 'day' | 'night' => {
    const hour = date.getHours();
    const isHabil = isWorkingDay(date);

    if (isHabil) {
        // Working Day logic: 08:00 split
        if (hour >= 8 && hour < 20) return 'day';
        return 'night';
    } else {
        // Non-working Day logic: 09:00 split
        if (hour >= 9 && hour < 20) return 'day';
        return 'night';
    }
};

/**
 * Extracts the names of nurses assigned to a specific shift from a daily record.
 */
export const getNurseAuthors = (
    record: DailyRecord | null | undefined,
    shift?: 'day' | 'night'
): string | undefined => {
    if (!record) return undefined;

    const targetShift = shift || getCurrentShift();
    const nurses = targetShift === 'day' ? record.nursesDayShift : record.nursesNightShift;

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
    record: DailyRecord | null | undefined,
    shift?: 'day' | 'night'
): string | undefined => {
    if (!isSharedNursingAccount(userId)) return undefined;
    return getNurseAuthors(record, shift);
};
