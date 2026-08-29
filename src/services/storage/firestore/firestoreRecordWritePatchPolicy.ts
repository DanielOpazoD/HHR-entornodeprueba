import type { DailyRecordPartialWriteOptions } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { flattenObject } from '@/services/storage/firestore/firestoreShared';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';

export const buildAuthorityPatchSyncContract = (
  syncContract: SyncTaskContract | undefined,
  authorityPatch: Record<string, unknown>
): SyncTaskContract | undefined => {
  if (!syncContract) return undefined;
  const authorityPaths = Object.keys(authorityPatch);
  const changedPaths = (syncContract.changedPaths ?? []).filter(path =>
    authorityPaths.includes(path)
  );
  return {
    ...syncContract,
    changedPaths: changedPaths.length > 0 ? changedPaths : authorityPaths,
  };
};

export const prepareFirestorePartialData = ({
  partialData,
  specialistScopedPatch,
  intentionalBedClear,
}: {
  partialData: Record<string, unknown>;
  specialistScopedPatch: boolean;
  intentionalBedClear: DailyRecordPartialWriteOptions['intentionalBedClear'];
}): Record<string, unknown> => {
  if (!intentionalBedClear) {
    return specialistScopedPatch ? partialData : flattenObject(partialData);
  }

  const bedPath = `beds.${intentionalBedClear.bedId}`;
  const allowedPaths = new Set([bedPath, `${bedPath}.clinicalEpisodeId`, 'dateTimestamp']);
  const generatedEpisodePath = `${bedPath}.clinicalEpisodeId`;
  const unexpectedPath = Object.keys(partialData).find(path => !allowedPaths.has(path));
  if (
    !intentionalBedClear.bedId ||
    intentionalBedClear.bedId.includes('.') ||
    !Object.prototype.hasOwnProperty.call(partialData, bedPath) ||
    unexpectedPath ||
    (partialData[generatedEpisodePath] !== undefined && partialData[generatedEpisodePath] !== '')
  ) {
    throw new ConcurrencyError(
      'La limpieza confirmada debe contener únicamente una cama completa y sus metadatos vacíos.'
    );
  }
  return { [bedPath]: partialData[bedPath] };
};
