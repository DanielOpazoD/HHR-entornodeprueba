/**
 * Deterministic JSON-like key for structural comparisons in the Rayen import: object keys sorted,
 * undefined object entries omitted, and undefined values (top level or inside arrays) written as null.
 * Not a fingerprint: `canonicalizeClinicalValue` keeps its own encoding for stored clinical identities.
 */
export const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};
