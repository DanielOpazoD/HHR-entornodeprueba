import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { isSameIdentityUnderReview } from '@/shared/census/patientIdentityReview';

const SLOT_PATH = /^beds\.([^.]+)(\.clinicalCrib)?/;

/**
 * The changed paths of `local` that a merge into `merged` left out, in each bed or crib whose
 * identity under review the stored copy no longer shares: edits written for a patient the stored
 * day may not hold. They stay pending as a conflict; they are never acknowledged as written.
 */
export const findDetachedReviewEdits = (
  remote: DailyRecord,
  local: DailyRecord,
  merged: DailyRecord,
  changedPaths: readonly string[]
): string[] =>
  (changedPaths.length && !changedPaths.some(path => path === '*' || path === 'beds')
    ? changedPaths
    : Object.keys(local.beds).map(bedId => `beds.${bedId}`)
  )
    // A whole bed holds a newborn crib of its own identity: each slot answers for itself.
    .flatMap(path => (/^beds\.[^.]+$/.test(path) ? [path, `${path}.clinicalCrib`] : [path]))
    .filter(path => {
      const [, bedId, crib] = SLOT_PATH.exec(path) ?? [];
      const slotOf = (day: DailyRecord) => (crib ? day.beds[bedId]?.clinicalCrib : day.beds[bedId]);
      const remoteSlot = bedId ? slotOf(remote) : undefined;
      const localSlot = bedId ? slotOf(local) : undefined;
      return (
        !!remoteSlot &&
        !!localSlot &&
        isSameIdentityUnderReview(remoteSlot, localSlot) === false &&
        JSON.stringify(getValueAtPath(merged, path)) !== JSON.stringify(getValueAtPath(local, path))
      );
    });
