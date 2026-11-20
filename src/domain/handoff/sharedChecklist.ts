import { isCalendarDate } from '@/utils/clinicalDateUtils';

export const isValidCrashCartReviewDate = (value: string): boolean =>
  value === '' || isCalendarDate(value);
