/**
 * Pure decision for the stale-day edit guard: should an edit to the currently
 * viewed clinical day flow straight through, or does it require an explicit
 * confirmation first?
 *
 * - `currentDateString` is the day being viewed/edited (YYYY-MM-DD).
 * - `clinicalToday` is the active clinical day (08:00 business / 09:00 weekend
 *   shift rollover — see resolveCurrentClinicalDay).
 * - `alreadyConfirmed` is true once the user has confirmed editing this stale day
 *   in the session, so we never re-prompt on every keystroke (one confirm per day).
 *
 * Future days are blocked upstream by the date strip, so a mismatch here always
 * means a PAST clinical day.
 */
export type StaleDayEditDecision = 'allowed' | 'requires-confirmation';

export const resolveStaleDayEditDecision = ({
  currentDateString,
  clinicalToday,
  alreadyConfirmed,
}: {
  currentDateString: string;
  clinicalToday: string;
  alreadyConfirmed: boolean;
}): StaleDayEditDecision => {
  if (currentDateString === clinicalToday) return 'allowed';
  if (alreadyConfirmed) return 'allowed';
  return 'requires-confirmation';
};
