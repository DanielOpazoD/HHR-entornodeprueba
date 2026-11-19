import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

/**
 * Pure value reads and comparisons shared by the controllers that judge a patch
 * against a day hydrated from the server. Decisions stay in each controller.
 */

/** Reads a dotted path; a missing step or a non-object yields `undefined`. */
export const getPathValue = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);

/** Structural inequality where `null`, `undefined` and an absent value are the same. */
export const valuesDiffer = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

export const hasOwnPatchPath = (patch: DailyRecordPatch, path: string): boolean =>
  Object.prototype.hasOwnProperty.call(patch, path);

export const getPatchValue = (patch: DailyRecordPatch, path: string): unknown =>
  (patch as Record<string, unknown>)[path];

export const normalizeComparableText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const hasMeaningfulText = (value: unknown): boolean =>
  normalizeComparableText(value).length > 0;

/** True only when the patch writes `attemptedPath` and its value equals the hydrated one. */
export const patchValueMatchesHydratedRecord = (
  attemptedPatch: DailyRecordPatch,
  attemptedPath: string,
  hydratedRecord: DailyRecord,
  canonicalPath: string
): boolean => {
  if (!hasOwnPatchPath(attemptedPatch, attemptedPath)) {
    return false;
  }
  return !valuesDiffer(
    getPatchValue(attemptedPatch, attemptedPath),
    getPathValue(hydratedRecord, canonicalPath)
  );
};
