import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

/** Calendar dates are labels: do not convert them through UTC or shift the census day. */
export const cudyrExcelDate = (value: string) => formatDateDDMMYYYY(value);

/** Full year and 24-hour clock, always in Rapa Nui, independently of the browser locale. */
export const cudyrExcelMoment = (value: string) => {
  if (!value) return 'No informado';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return cudyrExcelDate(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const stamp = calendarStampInClinicalTimeZone(date);
  return `${cudyrExcelDate(stamp.iso)} ${stamp.hhmm}`;
};

/** Only for explanatory date text, never identifiers, patient data or original category values. */
export const cudyrExcelDateText = (value: string) =>
  value
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, cudyrExcelDate)
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, '$1-$2-$3');
