import {
  assertSameOccupantAtPath,
  hasSamePatchBaseValue,
  staleDailyRecordError,
} from '@/services/storage/sync/fullSaveNoteBaseGuard';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { applyPatches } from '@/utils/patchUtils';

/**
 * A day's pending truth is its local projection plus the unresolved write that holds it. A write
 * computed from another base must land on top of that projection: its changed paths take its
 * values and every other pending path keeps the value another accepted write gave it.
 */

export type PendingProjectionRebase = (
  projection: DailyRecord,
  pendingPaths: string[]
) => DailyRecord;

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);

/** A legacy or whole-record write does not say which paths it owns. */
export const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

/** Journals keep concurrent ids; a Rayen entry changes only against its writer's base. */
const mergeJournalValue = (
  path: string,
  value: unknown,
  projected: unknown,
  base?: unknown
): unknown[] | null => {
  if (
    path === 'rayenSyncHistory' &&
    Array.isArray(value) &&
    (projected == null || Array.isArray(projected))
  ) {
    const current = projected as DailyRecord['rayenSyncHistory'];
    const currentById = new Map((current ?? []).map(event => [event.id, event]));
    const baseById = new Map(
      (Array.isArray(base) ? (base as RayenSyncEvent[]) : []).map(event => [event.id, event])
    );
    const incomingById = new Map((value as RayenSyncEvent[]).map(event => [event.id, event]));
    const changed = Array.from(incomingById.values()).filter(event => {
      const previous = baseById.get(event.id);
      if (hasSameComparableValue(event, previous)) return false;
      const stored = currentById.get(event.id);
      if (!hasSameComparableValue(stored, previous) && !hasSameComparableValue(stored, event)) {
        throw staleDailyRecordError('Otra pestaña cambió esta corrida Rayen');
      }
      return true;
    });
    return mergeRayenSyncHistory(current, changed);
  }
  return MOVEMENT_LOG_PATHS.has(path) && Array.isArray(value) && Array.isArray(projected)
    ? mergeMovementArrayById(projected, value, true)
    : null;
};

/**
 * Default for a record queued without its base (a retry or an auto-merge of a write that already
 * reached the outbox): its changed paths are that write's latest intent.
 */
export const buildRecordOverlayRebase = (
  record: DailyRecord,
  changedPaths: readonly string[] | undefined,
  isRemoteMerge: boolean
): PendingProjectionRebase | undefined => {
  const ownPaths = (changedPaths ?? []).filter(Boolean);
  if (isOpaqueChangedPaths(ownPaths)) return undefined;
  return (projection, pendingPaths) => {
    let base = projection;
    if (isRemoteMerge) {
      // This record already resolved a remote conflict. Retain remote fields except
      // where an unresolved accepted write explicitly owns a pending local value.
      if (pendingPaths.includes('*')) {
        throw new ConcurrencyError(
          'No se puede reconciliar una escritura pendiente sin sus rutas.'
        );
      }
      const pendingPatch: DailyRecordPatch = {};
      pendingPaths.forEach(path => {
        assertSameOccupantAtPath(path, projection, record);
        const value = getValueAtPath(projection, path);
        pendingPatch[path] = mergeJournalValue(path, value, getValueAtPath(record, path)) ?? value;
      });
      base = applyPatches(record, pendingPatch);
    }
    const patch: DailyRecordPatch = {};
    ownPaths.forEach(path => {
      assertSameOccupantAtPath(path, record, projection);
      const value = getValueAtPath(record, path);
      patch[path] = mergeJournalValue(path, value, getValueAtPath(base, path)) ?? value;
    });
    return { ...applyPatches(base, patch), lastUpdated: record.lastUpdated };
  };
};

/**
 * A new patch and the record it was computed from. When another accepted write already changed
 * the day's pending projection (another tab, or a read that showed an older copy), the patch is
 * prepared again on top of that projection. A path both writes changed follows the conflict
 * policy, not last-write-wins: append-only journals merge by id, anything else is rejected.
 */
export const buildPatchRebase =
  ({ baseRecord, patch, prepare }: DailyRecordPatchWrite): PendingProjectionRebase =>
  projection => {
    // Normalize the optimistic base just as persistence does before comparing its values.
    const storedBase = prepare(baseRecord, {});
    const storedProjection = prepare(projection, {});
    const rebasedPatch: DailyRecordPatch = {};
    Object.entries(patch).forEach(([path, value]) => {
      assertSameOccupantAtPath(path, storedBase, storedProjection);
      const projected = getValueAtPath(storedProjection, path);
      if (
        hasSamePatchBaseValue(getValueAtPath(storedBase, path), projected) ||
        hasSameComparableValue(value, projected)
      ) {
        rebasedPatch[path] = value;
        return;
      }
      const merged = mergeJournalValue(path, value, projected, getValueAtPath(storedBase, path));
      if (!merged) {
        throw staleDailyRecordError('Otra pestaña cambió este dato');
      }
      rebasedPatch[path] = merged;
    });
    return prepare(projection, rebasedPatch);
  };
