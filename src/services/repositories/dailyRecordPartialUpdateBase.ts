import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import { resolveRecordBaseRevision } from '@/services/storage/sync/syncTaskContractPolicy';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';
import { canRebaseManualSpecialtyIntent } from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { isValidRemoteAuthorityRecord } from '@/services/repositories/dailyRecordRemotePersistenceState';

/** The day a patch is applied to: the durable local copy, or the server's when there is none. */
export const resolvePartialUpdateBaseRecord = async (
  date: string,
  options: PartialUpdateDailyRecordOptions = {}
): Promise<DailyRecord | null> => {
  // Remote-first commands verify their proposed base in the authority transaction before saving.
  if (options.requireRemoteAuthorityFirst && options.baseRecord?.date === date) {
    return options.baseRecord;
  }
  const localRecord =
    options.baseRecord?.date === date && options.specialtyIntent?.kind === 'manual'
      ? await getRecordFromIndexedDB(date).catch(() => null)
      : await getRecordFromIndexedDB(date);
  if (
    (localRecord || options.specialtyIntent?.kind === 'manual') &&
    options.baseRecord?.date === date
  ) {
    if (options.specialtyIntent?.kind === 'manual') {
      // A preceding write in this date's turn may already have adopted a newer day locally.
      // This is only a proposed CAS base: the server still confirms the episode and decision.
      if (
        isValidRemoteAuthorityRecord(localRecord, date) &&
        (resolveRecordBaseRevision(localRecord) ?? -1) >
          (resolveRecordBaseRevision(options.baseRecord) ?? -1) &&
        canRebaseManualSpecialtyIntent(options.specialtyIntent, options.baseRecord, localRecord)
      ) {
        return localRecord;
      }
    }
    return options.baseRecord;
  }

  if (localRecord) {
    return localRecord;
  }

  if (!isFirestoreEnabled()) {
    return null;
  }

  try {
    const remoteRecord = await getRecordFromFirestore(date, { source: 'server' });
    if (!remoteRecord) {
      return null;
    }

    if (
      options.baseRecord?.date === date &&
      (options.baseRecord.lastUpdated !== remoteRecord.lastUpdated ||
        resolveRecordBaseRevision(options.baseRecord) !== resolveRecordBaseRevision(remoteRecord))
    ) {
      throw new ConcurrencyError('El censo cambió. Recargue antes de volver a editar.');
    }

    // Admitted like a read, against the copy found absent: one that a pending write holds, or
    // that another tab stored during the fetch, stays and becomes the base instead.
    const localResult = await saveToIndexedDB(remoteRecord, {
      preserveUnresolvedWrites: true,
      expectedBase: { kind: 'stored', record: null },
    });
    if (!localResult.ok) {
      throw localResult.error instanceof Error
        ? localResult.error
        : new Error(localResult.userSafeMessage || 'No fue posible guardar la base remota local.');
    }
    return localResult.superseded?.stored ?? localResult.retainedRecord ?? remoteRecord;
  } catch (error) {
    dailyRecordWriteLogger.warn(
      `Remote base fetch failed for ${date}; partial update aborted`,
      error
    );
    return null;
  }
};
