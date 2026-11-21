import { isCalendarDate } from '@/utils/clinicalDateUtils';

export const isValidCrashCartReviewDate = (value: string): boolean =>
  value === '' || isCalendarDate(value);

/** The shared checklist holds the crash-cart review date and its 8-digit code, or nothing. */
export const isValidSharedChecklistValue = (field: string, value: boolean | string): boolean =>
  typeof value === 'string' &&
  ((field === 'crashCartCode' && /^(?:[0-9]{8})?$/.test(value)) ||
    (field === 'crashCartReviewDate' && isValidCrashCartReviewDate(value)));
