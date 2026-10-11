import { z } from 'zod';

export const RUT_REGEX = /^(\d{1,2}\.?\d{3}\.?\d{3}[-]?[\dkK])?$/; // Chilean RUT format (optional)
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD format

/**
 * Helper for fields that can be null in Firestore (empty) but should be undefined in the app
 */
export const nullableOptional = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullable()
    .optional()
    .transform(v => v ?? undefined);

// Immutable validators shared by patient, census and movement contracts.
export const StringSchema = z.string();
export const OptionalStringSchema = StringSchema.optional();
export const NullableOptionalStringSchema = nullableOptional(StringSchema);
export const DefaultEmptyStringSchema = StringSchema.default('');

export const nullishDefault = <T extends z.ZodTypeAny>(
  schema: T,
  createDefault: () => z.input<T>
) => z.preprocess(v => (v === null || v === undefined ? createDefault() : v), schema);

export const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(v => (v === '' ? undefined : v), schema.optional());

export const resolveLegacyNameParts = (
  patientName: string
): {
  firstName: string;
  lastName: string;
  secondLastName: string;
} => {
  const normalizedName = patientName.trim().replace(/\s+/g, ' ');
  if (!normalizedName) {
    return { firstName: '', lastName: '', secondLastName: '' };
  }

  const segments = normalizedName.split(' ');
  if (segments.length === 1) {
    return { firstName: segments[0], lastName: '', secondLastName: '' };
  }
  if (segments.length === 2) {
    return { firstName: segments[0], lastName: segments[1], secondLastName: '' };
  }

  return {
    firstName: segments.slice(0, -2).join(' '),
    lastName: segments[segments.length - 2],
    secondLastName: segments[segments.length - 1],
  };
};

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
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

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
