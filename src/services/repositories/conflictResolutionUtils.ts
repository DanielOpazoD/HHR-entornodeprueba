import type { DailyRecord } from '@/types/domain/dailyRecord';

export const getValueAtPath = (source: unknown, path: string): unknown => {
  const parts = path.split('.');
  let cursor: unknown = source;

  for (const part of parts) {
    if (cursor == null) {
      return undefined;
    }
    if (Array.isArray(cursor)) {
      const index = Number(part);
      cursor = Number.isNaN(index) ? undefined : cursor[index];
      continue;
    }
    if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }

  return cursor;
};

const toComparablePatchValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(toComparablePatchValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toComparablePatchValue(entryValue)])
  );
};

/** Key order and Firestore-omitted undefined values do not change a value. */
export const hasSameComparableValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(toComparablePatchValue(left)) === JSON.stringify(toComparablePatchValue(right));

/** Compare every requested patch path after normalizing Firestore-omitted undefined values. */
export const hasSameValuesAtPaths = (
  source: unknown,
  expectedValues: Record<string, unknown>
): boolean =>
  Object.entries(expectedValues).every(([path, expected]) =>
    hasSameComparableValue(getValueAtPath(source, path), expected)
  );

export const normalizeChangedPaths = (changedPaths?: string[]): string[] => {
  if (!changedPaths || changedPaths.length === 0) return [];
  return Array.from(new Set(changedPaths.map(path => path.trim()).filter(Boolean)));
};

export const toMillis = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const toIso = (value: number): string => new Date(value || Date.now()).toISOString();

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isPrimitive = (value: unknown): value is string | number | boolean =>
  ['string', 'number', 'boolean'].includes(typeof value);

/**
 * Reads a field by a key known only at run time, exactly as `source[key]` does: a stored object may
 * carry keys its type omits, and a legacy day may hold a primitive there, which an index read boxes.
 */
export const readField = (source: object, key: string): unknown =>
  Reflect.get(Object(source), key, source);

/**
 * Day-record fields merged by one rule. `has` narrows a run-time key to one of them, so the caller
 * reads the field with its declared type and a renamed field stops compiling.
 */
export const dailyRecordFieldSet = <const Field extends keyof DailyRecord>(
  fields: readonly Field[]
) => {
  const names: ReadonlySet<string> = new Set(fields);
  return { has: (key: string): key is Field => names.has(key) };
};
