/**
 * Normalize a person name to "primera letra mayúscula, resto minúscula" per word
 * ("JUAN PÉREZ" or "juan pérez" → "Juan Pérez"). Rayen commonly returns names in
 * uppercase. Capitalizes the first letter after a space, hyphen or apostrophe, and is
 * accent-aware (á → Á).
 */
export const toTitleCaseName = (value?: string): string =>
  (value ?? '')
    .trim()
    // Normalize whitespace before joining given names.
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, sep: string, ch: string) => sep + ch.toUpperCase());

/** Remove only whole administrative tokens, preserving real names and surname order. */
const ADMINISTRATIVE_NAME_TOKENS = new Set(['urgencia', 'urgencias', 'sapu']);

const stripAdministrativeNameTokens = (value: string): string =>
  value
    .split(' ')
    .filter(word => word && !ADMINISTRATIVE_NAME_TOKENS.has(word.toLowerCase()))
    .join(' ');

/**
 * Nombres de pila ya normalizados (title case, sin relleno ni marcadores).
 * Si TODOS eran marcadores, el resultado es vacío a propósito: el paciente
 * queda identificado por apellidos (y RUT), igual que un nombre de pila no
 * informado. No se inventa un nombre ni se conserva el marcador.
 */
export const composeRayenGivenNames = (firstGivenName?: string, nextGivenNames?: string): string =>
  stripAdministrativeNameTokens(
    toTitleCaseName([firstGivenName, nextGivenNames].filter(Boolean).join(' '))
  );

/**
 * Rayen sometimes serializes a missing optional surname as a display placeholder.
 * Placeholders are absence, not clinical identity data, so they must never be persisted in HHR.
 */
export const normalizeOptionalPersonName = (value?: string): string => {
  const normalized = toTitleCaseName(value);
  return /^(?:no\s*informad[oa]?|sin\s+informaci[oó]n)$/i.test(normalized) ? '' : normalized;
};
