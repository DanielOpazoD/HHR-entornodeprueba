import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { PatientData } from '../contracts/rayenDomainContracts';
import { canonicalizeClinicalValue, clinicalValuesEqual } from './clinicalIncrementalSync';

export type CanonicalClinicalField =
  | 'devices'
  | 'deviceDetails'
  | 'deviceInstanceHistory'
  | 'evaluationScores'
  | 'vitalSigns'
  | 'vitalSignsHistory'
  | 'clinicalSyncCheckpoint';

const sortedByCanonicalValue = <T>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    canonicalizeClinicalValue(left).localeCompare(canonicalizeClinicalValue(right))
  );

const normalizeItems = (value: unknown): unknown => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  return {
    ...object,
    ...(Array.isArray(object.items)
      ? { items: sortedByCanonicalValue(object.items.map(normalizeItems)) }
      : {}),
  };
};

const normalizeEvaluationScores = (value: unknown): unknown => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
  const scores = value as Record<string, unknown>;
  const cudyr = normalizeItems(scores.cudyr);
  return {
    ...scores,
    ...(scores.braden ? { braden: normalizeItems(scores.braden) } : {}),
    ...(scores.downton ? { downton: normalizeItems(scores.downton) } : {}),
    ...(scores.cudyr ? { cudyr } : {}),
    ...(Array.isArray(scores.history)
      ? { history: sortedByCanonicalValue(scores.history.map(normalizeItems)) }
      : {}),
  };
};

// Legacy hydration removes null leaves. Only the nullable measurement fields are equivalent
// when absent: preserve timestamps, source identity, attribution, zeroes and empty strings.
const NULLABLE_VITAL_FIELDS = [
  'systolic',
  'diastolic',
  'heartRate',
  'spo2',
  'temperature',
  'respiratoryRate',
  'painEva',
  'hgt',
  'insulinUnits',
  'insulinQuadrant',
  'observations',
] as const satisfies ReadonlyArray<keyof PatientVitalSigns>;

const normalizeVitalForComparison = (value: unknown): unknown => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
  const vital = value as Record<string, unknown>;
  return {
    ...vital,
    ...Object.fromEntries(NULLABLE_VITAL_FIELDS.map(key => [key, vital[key] ?? null])),
  };
};

const normalizeClinicalFieldValue = (
  field: CanonicalClinicalField,
  value: PatientData[CanonicalClinicalField]
): unknown => {
  if (field === 'devices') {
    return [...new Set(Array.isArray(value) ? value.map(String) : [])].sort();
  }
  if (field === 'deviceDetails') return value ?? {};
  if (field === 'vitalSigns') return normalizeVitalForComparison(value);
  if (field === 'vitalSignsHistory') {
    return sortedByCanonicalValue(
      (Array.isArray(value) ? value : []).map(normalizeVitalForComparison)
    );
  }
  if (field === 'deviceInstanceHistory') {
    return sortedByCanonicalValue<unknown>(Array.isArray(value) ? [...value] : []);
  }
  if (field === 'evaluationScores') return normalizeEvaluationScores(value);
  return value;
};

/** Compares clinical meaning while ignoring persistence or source collection ordering. */
export const clinicalFieldValuesEqual = (
  field: CanonicalClinicalField,
  left: PatientData[CanonicalClinicalField],
  right: PatientData[CanonicalClinicalField]
): boolean =>
  clinicalValuesEqual(
    normalizeClinicalFieldValue(field, left),
    normalizeClinicalFieldValue(field, right)
  );
