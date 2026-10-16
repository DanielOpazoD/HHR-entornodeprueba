import { isValidRut } from '@/utils/rutUtils';

/** Existing checksum validation is intentionally permissive for imports. Forms also require
 * a recognizable RUT string, so letters discarded by normalization cannot change identity. */
export const isClinicalFormRut = (value: string): boolean =>
  /^\s*\d[\d.\s]*-?[\dkK]\s*$/.test(value) && isValidRut(value);
