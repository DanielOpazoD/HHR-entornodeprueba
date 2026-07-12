/**
 * Data formatters for Excel export
 */

export { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
export { formatAge } from '@/utils/ageDisplayUtils';

export function mapBedType(type: string): string {
  if (type.toLowerCase() === 'cuna') return 'MEDIA';
  return type.toUpperCase();
}

/** @deprecated Use formatDateDDMMYYYY instead — identical conversion YYYY-MM-DD → DD-MM-YYYY */
export { formatDateDDMMYYYY as formatSheetDate } from '@/utils/dateDisplayUtils';
