import { addCalendarDays, isCalendarDate } from '@/utils/clinicalDateUtils';
import { isWithinNurseEditingWindow } from '@/utils/clinicalWallClock';

/**
 * «¿Puede escribir este día?» (SAVE-04) is not one question: each operation keeps its own
 * predicate here, and they differ on purpose. They share one calculation, the nurse editing
 * window on the hospital clock (`isWithinNurseEditingWindow` in `utils/clinicalWallClock.ts`),
 * which nothing else imports. The fifth one, editing CUDYR by date (today or yesterday on the
 * calendar, the administrator free), is `canEditCudyrForDate` in `operationalAccessPolicy.ts`.
 * The server rules decide on their own and are not changed by these.
 */

/** The role as callers hold it: a domain role, free text from a stored profile, or none yet. */
type DayWriterRole = string | null | undefined;

/**
 * Editing the census and filing Rayen corrections on a census day: the administrator writes any
 * day (`isAdmin` is `isAdminAppRole(role)`); every other role only inside the nurse window.
 */
export const canWriteCensusDay = (
  day: string,
  isAdmin: boolean,
  now: number = Date.now()
): boolean => isAdmin || isWithinNurseEditingWindow(day, now);

/**
 * «Paciente no válido» also removes the episode from the previous census day: only inside the
 * nurse window, for every role, the administrator too (owner decision 2026-11-05). Unlike a
 * correction, it touches a day nobody asked to edit.
 */
export const canCleanInvalidEpisodeDay = (day: string, now: number = Date.now()): boolean =>
  isWithinNurseEditingWindow(day, now);

/**
 * CUDYR of the previous census day from a Rayen run: the administrator or hospital nursing, and
 * only for the calendar day right before the source census, not the 48 h window.
 */
export const canApplyPreviousDayCudyr = ({
  role,
  censusDay,
  sourceDate,
}: {
  role: DayWriterRole;
  censusDay: string;
  sourceDate: string;
}): boolean =>
  (role === 'admin' || role === 'nurse_hospital') &&
  isCalendarDate(sourceDate) &&
  addCalendarDays(sourceDate, -1) === censusDay;

/**
 * Releasing census sends refused after the window closed: only hospital nursing writes days under
 * a window that closes. The administrator has none, so the server never refuses them for it.
 */
export const canReleaseClosedWindowRefusals = (role: DayWriterRole): boolean =>
  role === 'nurse_hospital';
