/**
 * Normalización explícita de códigos CIE-10 para la memoria diagnóstica y las
 * reglas. La memoria asocia CÓDIGOS exactos, nunca texto libre: "J18.9",
 * "j189" y " J18.9 " son la misma asociación; descripciones con tildes
 * distintas no duplican reglas.
 */

/** Quita espacios, puntos y guiones; deja solo [A-Z0-9] en mayúsculas. */
const stripToAlphanumeric = (value: string): string =>
  value
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Forma canónica: letra + dos dígitos + subcategoría opcional separada por
 * punto (`J18.9`, `A00`, `O80.1`). Devuelve `undefined` si el valor no tiene
 * forma CIE-10 bien formada.
 */
export const normalizeCie10Code = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const compact = stripToAlphanumeric(raw.trim());
  if (!/^[A-Z][0-9]{2}[0-9A-Z]{0,4}$/.test(compact)) return undefined;
  if (compact.length <= 3) return compact;
  return `${compact.slice(0, 3)}.${compact.slice(3)}`;
};

export const isWellFormedCie10Code = (raw: unknown): boolean =>
  normalizeCie10Code(raw) !== undefined;

/** Igualdad por código normalizado; las etiquetas/descripciones no participan. */
export const sameCie10Code = (left: unknown, right: unknown): boolean => {
  const a = normalizeCie10Code(left);
  const b = normalizeCie10Code(right);
  return a !== undefined && a === b;
};

/** Normaliza un conjunto de códigos; devuelve `undefined` si alguno es inválido. */
export const normalizeCie10CodeSet = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const codes: string[] = [];
  for (const item of raw) {
    const code = normalizeCie10Code(item);
    if (!code) return undefined;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
};
