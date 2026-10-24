import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordPendingProjectionRebase } from '@/services/storage/sync';
import {
  assertSameOccupantAtPath,
  carriesProjectionValuesAt,
  isOpaqueChangedPaths,
  isSameRecordValue,
  mergeMovementLogValue,
  readRecordPath,
} from '@/services/storage/sync/pendingDailyRecordProjectionPolicy';
import { preparePatchedRecordForPersistence } from '@/services/repositories/dailyRecordPatchPreparation';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

/**
 * A new patch and the record it was computed from. When another accepted write already changed
 * the day's pending projection (another tab, or a read that showed an older copy), the patch is
 * prepared again on top of that projection. A path both writes changed follows the conflict
 * policy, not last-write-wins: movement logs merge by id, anything else is rejected.
 */
export const buildPendingProjectionRebase =
  ({
    baseRecord,
    patch,
  }: {
    baseRecord: DailyRecord;
    patch: DailyRecordPatch;
  }): DailyRecordPendingProjectionRebase =>
  ({ projection, pendingChangedPaths }) => {
    if (baseRecord.lastUpdated === projection.lastUpdated) return null;
    // Compare with the base as it would have been stored: saving drops empty staffing slots and
    // derives bed fields, so a tab's own optimistic copy must not read as another tab's change.
    const storedBase = preparePatchedRecordForPersistence(baseRecord, baseRecord.date, {}).record;
    if (
      !isOpaqueChangedPaths(pendingChangedPaths) &&
      carriesProjectionValuesAt(storedBase, projection, pendingChangedPaths)
    ) {
      return null;
    }

    const rebasedPatch: DailyRecordPatch = {};
    Object.entries(patch).forEach(([path, value]) => {
      assertSameOccupantAtPath(path, storedBase, projection);
      const projected = readRecordPath(projection, path);
      if (
        isSameRecordValue(readRecordPath(storedBase, path), projected) ||
        isSameRecordValue(value, projected)
      ) {
        rebasedPatch[path] = value;
        return;
      }
      const merged = mergeMovementLogValue(path, value, projected);
      if (!merged) {
        throw new ConcurrencyError(
          'Otra pestaña cambió el mismo dato del censo. Recargue el censo antes de continuar.'
        );
      }
      rebasedPatch[path] = merged;
    });
    return preparePatchedRecordForPersistence(projection, projection.date, rebasedPatch).record;
  };
