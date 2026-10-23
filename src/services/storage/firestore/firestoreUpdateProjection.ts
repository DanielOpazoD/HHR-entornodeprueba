import { Timestamp, type DocumentData } from 'firebase/firestore';

/** The projection cannot prove what Firestore stored for this payload entry. */
export class UnsupportedFirestoreUpdateProjectionError extends Error {
  constructor(readonly path: string) {
    super(`Cannot project the Firestore update at "${path}".`);
    this.name = 'UnsupportedFirestoreUpdateProjectionError';
  }
}

// Same guard as the server's setValueAtPath: never walk into prototype keys.
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Firestore stores only plain objects as maps (same test as the SDK's isPlainObject). */
const isPlainMap = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const cloneBaseValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneBaseValue);
  if (isPlainMap(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneBaseValue(item)])
    );
  }
  // Timestamps and the other SDK value types read from a snapshot are immutable.
  return value;
};

/**
 * The value Firestore stores for one payload entry, as the SDK parses it with
 * ignoreUndefinedProperties: undefined is dropped from maps and becomes null in arrays, and a Date
 * becomes a Timestamp. FieldValue sentinels and any other class instance are refused.
 */
const toStoredValue = (value: unknown, path: string): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) {
    // Array.from also visits holes, which the SDK stores as null like undefined.
    return Array.from(value, item => (item === undefined ? null : toStoredValue(item, path)));
  }
  if (isPlainMap(value)) {
    const stored: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) stored[key] = toStoredValue(item, `${path}.${key}`);
    }
    return stored;
  }
  throw new UnsupportedFirestoreUpdateProjectionError(path);
};

/**
 * Projects the document that a committed `update(payload)` leaves when applied to `base`, the
 * snapshot read in the same transaction. Mirrors Firestore and the server's setValueAtPath:
 * entries apply in payload order, a non-map intermediate (absent, null, scalar, array, Timestamp)
 * becomes a map, and the leaf is replaced wholesale. Throws
 * UnsupportedFirestoreUpdateProjectionError instead of guessing; `base` is never mutated.
 */
export const projectFirestoreUpdate = (base: DocumentData, payload: DocumentData): DocumentData => {
  const projected = cloneBaseValue(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(payload)) {
    // update() leaves a top-level undefined field untouched (ignoreUndefinedProperties).
    if (value === undefined) continue;
    const segments = path.split('.');
    if (segments.some(segment => segment === '' || FORBIDDEN_PATH_SEGMENTS.has(segment))) {
      throw new UnsupportedFirestoreUpdateProjectionError(path);
    }
    const stored = toStoredValue(value, path);
    let cursor = projected;
    for (const segment of segments.slice(0, -1)) {
      if (!isPlainMap(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = stored;
  }
  return projected;
};
