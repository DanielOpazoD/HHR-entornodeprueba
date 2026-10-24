/**
 * Import guard for split days (D10 of docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). Kept
 * apart from the write hygiene so the eager write paths do not carry it: only the JSON import and
 * the admin backup restore, both loaded on demand, use it.
 */
import { CLINICAL_DERIVED_LAYOUT_FIELD } from '@/services/storage/clinicalDerivedConstants';
import { carriesClinicalDerivedLayout } from '@/services/storage/clinicalDerivedWriteHygiene';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Imports never replace a local split day with a copy that lost its marker, or carries another
 * one, unless that copy is strictly newer (an unreadable timestamp keeps the local day).
 */
const lastUpdatedMs = (record: unknown): number =>
  Date.parse(String(isPlainObject(record) ? (record.lastUpdated ?? '') : ''));

const sameMarker = (left: PlainObject, right: unknown): boolean =>
  isPlainObject(right) &&
  JSON.stringify(left[CLINICAL_DERIVED_LAYOUT_FIELD]) ===
    JSON.stringify(right[CLINICAL_DERIVED_LAYOUT_FIELD]);

export const isClinicalDerivedLayoutRegression = (local: unknown, incoming: unknown): boolean => {
  if (!carriesClinicalDerivedLayout(local) || sameMarker(local as PlainObject, incoming)) {
    return false;
  }
  const localMs = lastUpdatedMs(local);
  const incomingMs = lastUpdatedMs(incoming);
  return !(Number.isFinite(localMs) && Number.isFinite(incomingMs) && incomingMs > localMs);
};
