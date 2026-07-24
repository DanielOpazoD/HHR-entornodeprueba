import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';

type AnalyticsPatient = DailyRecord['beds'][string];

const EMPTY_IDENTITY_TOKENS = new Set([
  '',
  '-',
  '—',
  '–',
  'n/a',
  'no informado',
  'sin nombre',
  'sin rut',
]);

const hasMeaningfulIdentityValue = (value: unknown): boolean => {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('es-CL');
  return !EMPTY_IDENTITY_TOKENS.has(normalized);
};

/**
 * Analytics only counts observations that can be traced back to a patient.
 * A name or an identity document is enough because foreign patients may not
 * have a Chilean RUT and legacy records may contain only one of both fields.
 */
export const hasAnalyticsPatientIdentity = (patient: AnalyticsPatient): boolean =>
  hasMeaningfulIdentityValue(patient.patientName) || hasMeaningfulIdentityValue(patient.rut);
