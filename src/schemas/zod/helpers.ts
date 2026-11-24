import * as z from 'zod/mini';

import { comparableName } from '@/utils/legacyNameParts';

export const RUT_REGEX = /^(\d{1,2}\.?\d{3}\.?\d{3}[-]?[\dkK])?$/; // Chilean RUT format (optional)
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD format

export const preprocess = <T extends z.ZodMiniType>(fn: (value: unknown) => unknown, schema: T) =>
  z.pipe(z.transform(fn), schema);

/**
 * Helper for fields that can be null in Firestore (empty) but should be undefined in the app
 */
export const nullableOptional = <T extends z.ZodMiniType>(schema: T) =>
  z.pipe(
    z.optional(z.nullable(schema)),
    z.transform(v => v ?? undefined)
  );

// Immutable validators shared by patient, census and movement contracts.
export const StringSchema = z.string();
export const OptionalStringSchema = z.optional(StringSchema);
export const NullableOptionalStringSchema = nullableOptional(StringSchema);
export const DefaultEmptyStringSchema = z.prefault(StringSchema, '');

export const nullishDefault = <T extends z.ZodMiniType>(
  schema: T,
  createDefault: () => z.input<T>
) => preprocess(v => (v === null || v === undefined ? createDefault() : v), schema);

export const emptyStringToUndefined = <T extends z.ZodMiniType>(schema: T) =>
  preprocess(v => (v === '' ? undefined : v), z.optional(schema));

export { resolveLegacyNameParts } from '@/utils/legacyNameParts';

export const composeNameParts = (
  firstName: string | undefined,
  lastName: string | undefined,
  secondLastName: string | undefined
): string =>
  [firstName, lastName, secondLastName]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');

export const normalizeComparableName = (value: string | undefined): string =>
  comparableName(value || '');

export const normalizeLegacyIdentityValue = (value: string | undefined): string => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return '';
  }

  const lowered = normalized.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a' || lowered === 'na') {
    return '';
  }

  return normalized;
};

export const inferDocumentTypeFromIdentity = (
  identityValue: string | undefined
): 'RUT' | 'Pasaporte' | undefined => {
  const normalized = normalizeLegacyIdentityValue(identityValue);
  if (!normalized) {
    return undefined;
  }

  return RUT_REGEX.test(normalized) ? 'RUT' : 'Pasaporte';
};

export const hasMismatchedExplicitNameParts = ({
  patientName,
  firstName,
  lastName,
  secondLastName,
}: {
  patientName: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  secondLastName: string | undefined;
}): boolean => {
  const normalizedPatientName = normalizeComparableName(patientName);
  if (!normalizedPatientName) {
    return false;
  }

  const normalizedPartsName = normalizeComparableName(
    composeNameParts(firstName, lastName, secondLastName)
  );

  return Boolean(normalizedPartsName) && normalizedPartsName !== normalizedPatientName;
};
