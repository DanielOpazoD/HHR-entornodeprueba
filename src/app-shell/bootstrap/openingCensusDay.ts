import { resolveLandingCalendarDay } from '@/utils/clinicalDateUtils';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';

/**
 * The census day this page opens on: a real `?date=`, otherwise the hospital's clinical day,
 * never the device date. `src/index.tsx` calls it once per page load and hands the result to
 * both the header painted before sign-in and the census, so they never pick different days.
 */
export const resolveOpeningCensusDay = (): string =>
  resolveLandingCalendarDay(
    typeof window === 'undefined' ? '' : window.location.search,
    resolveCurrentClinicalDay()
  );
