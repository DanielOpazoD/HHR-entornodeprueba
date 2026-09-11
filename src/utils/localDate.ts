import { getClinicalCalendarDateISO } from './clinicalTimeZone';

/** Value for `<input type="date">` fields: the hospital calendar date of `date`. */
export const getLocalDateInputValue = (date = new Date()): string =>
  getClinicalCalendarDateISO(date);
