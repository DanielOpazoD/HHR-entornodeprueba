/**
 * Clinical Data Utilities
 *
 * Centralized logic for clinical data transformations to ensure consistency
 * between different PDF services and UI components.
 */

import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

/**
 * Split a full name into components: [nombres, primerApellido, segundoApellido]
 * Assumes format: Nombres ApellidoPaterno ApellidoMaterno
 * If 4+ words, assumes last two are surnames.
 */
export const splitPatientName = (fullName: string | undefined): [string, string, string] => {
  if (!fullName) return ['', '', ''];
  const parts = fullName.trim().split(/\s+/);
  const [first = '', second = '', third = ''] = parts;
  if (parts.length === 1) return [first, '', ''];
  if (parts.length === 2) return [first, second, ''];
  if (parts.length === 3) return [first, second, third];

  // 4 or more words: assume last two words are surnames
  const secApe = parts.pop() || '';
  const primApe = parts.pop() || '';
  return [parts.join(' '), primApe, secApe];
};

/**
 * Calculate age from birthDate string on the hospital calendar day.
 * Supports DD-MM-YYYY and YYYY-MM-DD.
 */
export const calculateAge = (birthDate: string | undefined): string => {
  if (!birthDate) return '';
  try {
    const [day = ''] = birthDate.trim().split('T');
    const parts = day.includes('-') ? day.split('-') : [];
    const [part0, part1, part2] = parts;
    if (
      parts.length !== 3 ||
      !part0 ||
      !part1 ||
      !part2 ||
      !/^\d+$/.test(part0) ||
      !/^\d+$/.test(part1) ||
      !/^\d+$/.test(part2)
    ) {
      return '';
    }

    let year: number;
    let month: number;
    let dayOfMonth: number;
    if (part0.length === 4) {
      year = Number(part0);
      month = Number(part1);
      dayOfMonth = Number(part2);
    } else if (part2.length === 4) {
      year = Number(part2);
      month = Number(part1);
      dayOfMonth = Number(part0);
    } else {
      return '';
    }

    if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) {
      return '';
    }

    const birth = new Date(Date.UTC(year, month - 1, dayOfMonth));
    if (
      Number.isNaN(birth.getTime()) ||
      birth.getUTCFullYear() !== year ||
      birth.getUTCMonth() !== month - 1 ||
      birth.getUTCDate() !== dayOfMonth
    ) {
      return '';
    }

    // Both are calendar days at UTC midnight read with UTC getters, so the device zone moves neither.
    const today = new Date(getClinicalCalendarDateISO());
    if (Number.isNaN(today.getTime())) {
      return '';
    }
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const m = today.getUTCMonth() - birth.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
    return `${age} años`;
  } catch {
    return '';
  }
};

/**
 * Format a date string to DD-MM-YYYY.
 * Robust fallback if already in DD-MM-YYYY.
 */
export const formatDateToCL = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  // Already DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [y, m, d] = dateStr.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
  }
  return dateStr;
};
