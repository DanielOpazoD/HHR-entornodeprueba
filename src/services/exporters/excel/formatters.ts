/**
 * Data formatters for Excel export
 */

export { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
export { formatAge } from '@/utils/ageDisplayUtils';

export function mapBedType(type: string): string {
  if (type.toLowerCase() === 'cuna') return 'MEDIA';
  return type.toUpperCase();
}
