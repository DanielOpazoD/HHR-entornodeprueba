import { calendarStampInClinicalTimeZone } from './clinicalTimeZone';

/**
 * Hospital wall-clock helpers built on `clinicalTimeZone`, kept apart from it because that
 * module is also bundled into the server-side CUDYR parser.
 */

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

const toUtcMinutes = (isoDate: string, hhmm: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
};

/** Wall-clock time the hospital shows at `instant`, as if it were UTC. */
const shownAt = (instant: number): number => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(new Date(instant));
  return toUtcMinutes(iso, hhmm);
};

/**
 * The instant at which the hospital clock shows `hhmm` on `isoDate`, using the zone offsets in
 * force just before and after it. Rapa Nui changes its clocks at 22:00: a time repeated in April
 * resolves to its first occurrence and a time skipped in September moves forward an hour, as
 * the clocks did.
 */
export const clinicalWallClockToDate = (isoDate: string, hhmm: string): Date => {
  const target = toUtcMinutes(isoDate, hhmm);
  const withEarlierOffset = target - (shownAt(target - HALF_DAY_MS) - (target - HALF_DAY_MS));
  const withLaterOffset = target - (shownAt(target + HALF_DAY_MS) - (target + HALF_DAY_MS));
  if (shownAt(withEarlierOffset) === target) return new Date(withEarlierOffset);
  if (shownAt(withLaterOffset) === target) return new Date(withLaterOffset);
  return new Date(withEarlierOffset);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The nurse editing window (SAVE-04): from 24 h before to 48 h after the census day's midnight in
 * Rapa Nui, as the Firestore rules and the daily-record functions allow. The administrator has no
 * window; callers decide that. A malformed day has no window, as on the server.
 */
const nurseEditingWindow = (day: string): { opensAfter: number; closesAt: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const midnight = clinicalWallClockToDate(day, '00:00');
  if (calendarStampInClinicalTimeZone(midnight).iso !== day) return null;
  const dayStart = midnight.getTime();
  return { opensAfter: dayStart - DAY_MS, closesAt: dayStart + 2 * DAY_MS };
};

/** Whether a nurse may still write `day` at `now`. A malformed day is outside it. */
export const isWithinNurseEditingWindow = (day: string, now: number = Date.now()): boolean => {
  const bounds = nurseEditingWindow(day);
  return !!bounds && now > bounds.opensAfter && now < bounds.closesAt;
};

/**
 * Whether the window of a real day has already passed at `now`, for good. A malformed day, or one
 * whose window is open or not open yet, has not closed.
 */
export const hasNurseEditingWindowClosed = (day: string, now: number = Date.now()): boolean => {
  const bounds = nurseEditingWindow(day);
  return !!bounds && now >= bounds.closesAt;
};
