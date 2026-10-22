/**
 * Bounds what an audit event stores. The trail records who did what to whom and the
 * before/after values; it is not a copy of the clinical record, a debug dump or an error log.
 */
import { excerptAroundChange } from '@/services/admin/auditTextExcerpt';

const MAX_TEXT_LENGTH = 1_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 4;
/** Never persisted: raw exception internals do not belong in clinical traceability. */
const DROPPED_KEYS = new Set(['stack', 'componentStack']);

const isTextChange = (value: unknown): value is { old: string; new: string } =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as { old?: unknown }).old === 'string' &&
  typeof (value as { new?: unknown }).new === 'string';

const compactValue = (value: unknown, depth: number): unknown => {
  // A long note keeps the part that changed on both sides, not just its beginning.
  if (isTextChange(value)) {
    const excerpt = excerptAroundChange(value.old, value.new, MAX_TEXT_LENGTH);
    return { ...value, old: excerpt.before, new: excerpt.after };
  }
  if (typeof value === 'string') {
    return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 1)}…` : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: compactValue(value.message, depth + 1) };
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[${value.length} elementos]`;
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => compactValue(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `+${value.length - MAX_ARRAY_ITEMS} más`]
      : items;
  }
  if (value && typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[…]';
    return compactAuditDetails(value as Record<string, unknown>, depth + 1);
  }
  return value;
};

export const compactAuditDetails = (
  details: Record<string, unknown>,
  depth = 0
): Record<string, unknown> => {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || DROPPED_KEYS.has(key)) continue;
    compacted[key] = compactValue(value, depth);
  }
  return compacted;
};
