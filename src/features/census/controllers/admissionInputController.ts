import { normalizeDateOnly } from '@/utils/clinicalDayUtils';
import {
  resolveAdmissionDateAudit as resolveAdmissionDateAuditPolicy,
  type AdmissionDateAuditResolution,
} from '@/domain/clinical-episode/admissionDatePolicy';
export {
  resolveAllowedAdmissionDates,
  resolveAdmissionDateOptions,
  type AdmissionDateOption,
} from '@/shared/date/admissionDateOptions';
export {
  resolveAdmissionTimePickerModel,
  resolveAdmissionTimeValue,
  type AdmissionTimePickerModel,
} from '@/shared/date/admissionTimeOptions';

/**
 * Resolves the tooltip text for the admission date cell.
 *
 * @param admissionTime - HH:MM string or undefined.
 * @returns Human-readable tooltip (e.g. "Hora de ingreso: 14:30").
 */
export const resolveAdmissionTooltip = (admissionTime?: string): string =>
  admissionTime ? `Hora de ingreso: ${admissionTime}` : 'Hora de ingreso: no registrada';

export const resolveIsCriticalAdmissionEmpty = (
  patientName?: string,
  admissionDate?: string
): boolean => Boolean(patientName) && !admissionDate;

/**
 * Determines whether the admission date input is editable on a given census day.
 *
 * Editability rules (in priority order):
 *  1. No patient in bed → **not editable**
 *  2. `firstSeenDate` matches `recordDate` → **editable** (modern patients)
 *  3. `firstSeenDate` set but doesn't match → **not editable** (past admission)
 *  4. No `firstSeenDate` but `admissionDate` matches `recordDate` → **editable**
 *     (legacy fallback — patients created before `firstSeenDate` existed)
 *  5. None of the above → falls back to `isNewAdmission` flag
 *
 * @example
 * // Modern patient on admission day
 * resolveAdmissionDateIsEditable({
 *   recordDate: '2026-04-10', firstSeenDate: '2026-04-10',
 *   hasPatient: true, isNewAdmission: true
 * }); // → true
 *
 * // Legacy patient on admission day (no firstSeenDate)
 * resolveAdmissionDateIsEditable({
 *   recordDate: '2026-04-10', admissionDate: '2026-04-10',
 *   hasPatient: true, isNewAdmission: false
 * }); // → true (admissionDate fallback)
 *
 * // Any patient on day after admission
 * resolveAdmissionDateIsEditable({
 *   recordDate: '2026-04-11', firstSeenDate: '2026-04-10',
 *   hasPatient: true, isNewAdmission: false
 * }); // → false
 */
export const resolveAdmissionDateIsEditable = ({
  recordDate,
  firstSeenDate,
  admissionDate,
  hasPatient,
  isNewAdmission,
}: {
  recordDate: string;
  firstSeenDate?: string;
  /** Fallback when firstSeenDate is not set (legacy patients). */
  admissionDate?: string;
  hasPatient?: boolean;
  isNewAdmission: boolean;
}): boolean => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedFirstSeenDate = normalizeDateOnly(firstSeenDate);

  if (!hasPatient) {
    return false;
  }

  if (normalizedRecordDate && normalizedFirstSeenDate) {
    return normalizedRecordDate === normalizedFirstSeenDate;
  }

  // Legacy fallback: if firstSeenDate is not set but admissionDate matches
  // the record date, the patient was admitted on this day and should be editable.
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  if (normalizedRecordDate && normalizedAdmissionDate) {
    return normalizedRecordDate === normalizedAdmissionDate;
  }

  return isNewAdmission;
};

export const resolveAdmissionDateAudit = ({
  recordDate,
  admissionDate,
  admissionTime,
  firstSeenDate,
}: {
  recordDate: string;
  admissionDate?: string;
  admissionTime?: string;
  firstSeenDate?: string;
}): AdmissionDateAuditResolution =>
  resolveAdmissionDateAuditPolicy({ recordDate, admissionDate, admissionTime, firstSeenDate });
