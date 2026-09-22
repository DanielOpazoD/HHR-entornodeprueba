import { normalizeRut } from '@/utils/rutUtils';

export type OfficialPatientDocumentType = 'RUT' | 'Pasaporte';

const PLACEHOLDER_IDENTIFIERS = new Set([
  'NN',
  'N/N',
  'SINRUT',
  'SIN-RUT',
  'SINRUN',
  'SIN-RUN',
  'NOINFORMADO',
  'NO-INFORMADO',
]);

const compactAlphanumeric = (value?: string): string =>
  (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const isChileanRutCandidate = (value: string): boolean =>
  /^[\d.\s-]+[0-9K]$/i.test(value) && /^\d{1,8}[0-9K]$/i.test(normalizeRut(value));

/**
 * Canonical comparison key for the official identifier supplied by Eloísa.
 *
 * Unlike `normalizeRut`, this keeps every letter in a foreign identifier. This is important for
 * passports such as A123 and B123, which must remain distinct clinical subjects.
 */
export const normalizeOfficialPatientIdentifier = (value?: string): string => {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!trimmed || PLACEHOLDER_IDENTIFIERS.has(trimmed.replace(/\s+/g, ''))) return '';
  // A syntactically RUT-like value keeps legacy separator-insensitive comparison even when the
  // verifier is invalid in an old fixture. Foreign identifiers retain their exact punctuation.
  if (isChileanRutCandidate(trimmed)) return normalizeRut(trimmed);
  return trimmed;
};

export const inferOfficialPatientDocumentType = (
  value?: string,
  explicitType?: OfficialPatientDocumentType
): OfficialPatientDocumentType | undefined => {
  const trimmed = (value ?? '').trim();
  if (!normalizeOfficialPatientIdentifier(trimmed)) return undefined;
  if (explicitType === 'Pasaporte') return 'Pasaporte';
  if (isChileanRutCandidate(trimmed)) {
    // A numeric identifier from legacy strategy 3 is ambiguous even when it happens to satisfy
    // the Chilean checksum. Only explicit metadata (or the distinctive K verifier) classifies it.
    return explicitType === 'RUT' || /K$/i.test(trimmed) ? 'RUT' : undefined;
  }
  // Some legacy snapshots labelled every identifier as RUT. A non-RUT alphanumeric code is
  // unequivocally foreign and must never be reformatted or truncated because of that stale label.
  if (/[A-Z]/i.test(compactAlphanumeric(trimmed))) return 'Pasaporte';
  return explicitType === 'RUT' ? 'RUT' : undefined;
};

const formatChileanRut = (value: string): string => {
  const cleaned = normalizeRut(value);
  if (cleaned.length < 2) return value.trim();
  const verifier = cleaned.slice(-1);
  const body = cleaned.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${verifier}`;
};

/** Preserves an official foreign code; only a proven Chilean RUT receives RUT punctuation. */
export const formatOfficialPatientIdentifier = (
  value?: string,
  explicitType?: OfficialPatientDocumentType
): string => {
  const trimmed = (value ?? '').trim().toUpperCase();
  const documentType = inferOfficialPatientDocumentType(trimmed, explicitType);
  if (documentType === 'RUT' && isChileanRutCandidate(trimmed)) {
    return formatChileanRut(trimmed);
  }
  return trimmed;
};

export const officialPatientIdentifiersEqual = (left?: string, right?: string): boolean => {
  const normalizedLeft = normalizeOfficialPatientIdentifier(left);
  return Boolean(normalizedLeft && normalizedLeft === normalizeOfficialPatientIdentifier(right));
};

/**
 * Typed identity key for clinical matching. Untyped numeric legacy values deliberately occupy a
 * separate namespace: a numeric passport must never become the holder of a same-looking RUT.
 */
export const officialPatientIdentityKey = (
  value?: string,
  documentType?: OfficialPatientDocumentType
): string => {
  const literal = (value ?? '').trim().toUpperCase();
  if (!normalizeOfficialPatientIdentifier(literal)) return '';
  const unequivocalForeign = !isChileanRutCandidate(literal) && /[A-Z]/i.test(literal);
  const resolvedType = unequivocalForeign ? 'Pasaporte' : documentType;
  if (resolvedType === 'Pasaporte') return `PAS:${literal}`;
  if (resolvedType === 'RUT') return `RUT:${normalizeOfficialPatientIdentifier(literal)}`;
  return `LEGACY:${literal}`;
};

export const officialPatientTypedIdentitiesEqual = (
  left?: string,
  leftDocumentType?: OfficialPatientDocumentType,
  right?: string,
  rightDocumentType?: OfficialPatientDocumentType
): boolean => {
  const leftKey = officialPatientIdentityKey(left, leftDocumentType);
  const rightKey = officialPatientIdentityKey(right, rightDocumentType);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const onlyKnownType = leftDocumentType ?? rightDocumentType;
  // Legacy numeric RUTs had no document metadata. Preserve that fallback only for RUT; an untyped
  // numeric value must never claim a proven passport identity.
  return Boolean(
    onlyKnownType === 'RUT' &&
    (!leftDocumentType || !rightDocumentType) &&
    normalizeOfficialPatientIdentifier(left) === normalizeOfficialPatientIdentifier(right)
  );
};
