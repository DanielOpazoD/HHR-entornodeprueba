/**
 * RUT/ID Validation Utilities
 * Pure functions for Chilean RUT validation.
 */

/**
 * Clean RUT string (remove dots and dashes)
 */
export const cleanRut = (rut: string): string => {
  return rut.replace(/[.-]/g, '').toUpperCase();
};

/** Canonical comparison key for RUT/RUN values from external systems. */
export const normalizeRut = (rut?: string): string =>
  (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Format RUT with dots and dash
 * Example: "123456789" -> "12.345.678-9"
 */
export const formatRut = (rut: string): string => {
  const cleaned = cleanRut(rut);
  if (cleaned.length < 2) return rut;

  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);

  // Add dots every 3 digits from right
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formatted}-${verifier}`;
};

/**
 * Calculate RUT verification digit
 */
export const calculateRutVerifier = (rutBody: string): string => {
  const cleaned = rutBody.replace(/\D/g, '');
  let sum = 0;
  let multiplier = 2;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    sum += parseInt(cleaned[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);

  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return remainder.toString();
};

/**
 * A letter other than the K check digit (the last letter or digit of the value; spaces or
 * punctuation may follow it). Such a value is a passport or free text, never a RUT.
 */
export const hasNonRutLetter = (value: string): boolean =>
  /\p{L}/u.test(value.replace(/[kK](?=[^\p{L}\p{N}]*$)/u, ''));

/**
 * Validate Chilean RUT
 */
export const isValidRut = (rut: string): boolean => {
  if (!rut) return false;

  // A passport is never read as a RUT.
  if (hasNonRutLetter(rut)) return false;

  // 1. Clean RUT (remove dots and dashes) and match user's logic
  const cleaned = rut.replace(/[^0-9kK]/g, '').toUpperCase();

  // 2. A Chilean RUT may have a one-digit body plus its verifier.
  if (cleaned.length < 2 || cleaned.length > 9) return false;

  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);

  // 3. Check body is numeric
  if (!/^\d+$/.test(body)) return false;

  // 4. Calculate and compare verifier (using existing robust logic)
  const expectedVerifier = calculateRutVerifier(body);
  return verifier === expectedVerifier;
};

/**
 * Two documents name the same RUT: the comparison of their normalized digits, except that a value
 * with letters (a passport) equals nothing. Normalizing alone would erase those letters and match
 * the passport with the RUT its digits happen to form.
 */
export const isSameRut = (left?: string, right?: string): boolean =>
  normalizeRut(left) === normalizeRut(right) &&
  !hasNonRutLetter(left ?? '') &&
  !hasNonRutLetter(right ?? '');

/** The same document: the same RUT, or the same passport text (separators and case aside). */
export const isSameDocument = (left?: string, right?: string): boolean =>
  isSameRut(left, right) ||
  (hasNonRutLetter(left ?? '') &&
    hasNonRutLetter(right ?? '') &&
    cleanRut((left ?? '').trim()) === cleanRut((right ?? '').trim()));

/**
 * Check if value looks like a passport (not a RUT)
 */
export const isPassportFormat = (value: string): boolean => {
  if (!value) return false;
  // Passport: starts with letter or has letters in middle
  const cleaned = value.replace(/[\s-.]/g, '');
  return /^[A-Za-z]/.test(cleaned) || /[A-Za-z]{2,}/.test(cleaned);
};

/**
 * The same RUT number registered with another, mistyped check digit, as MMRAD keeps some exams
 * (observed 2026-11-03). Only RUT-shaped values qualify: a passport is never read as a RUT.
 */
export const isSameRutWithOtherVerifier = (rut: string, other: string): boolean => {
  // Digits with one final check digit: a passport, with letters, never qualifies.
  if (!isValidRut(rut) || !/^\s*[\d.]+-?[\dkK]\s*$/.test(other)) return false;
  const expected = normalizeRut(rut);
  const candidate = normalizeRut(other);
  return (
    candidate.length === expected.length &&
    candidate.slice(0, -1) === expected.slice(0, -1) &&
    candidate.slice(-1) !== expected.slice(-1)
  );
};

/** `body-DV` for every check digit other than the valid one of this RUT. */
export const otherRutVerifierVariants = (rut: string): string[] => {
  if (!isValidRut(rut)) return [];
  const body = normalizeRut(rut).slice(0, -1);
  const valid = calculateRutVerifier(body);
  return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'K']
    .filter(verifier => verifier !== valid)
    .map(verifier => `${body}-${verifier}`);
};
