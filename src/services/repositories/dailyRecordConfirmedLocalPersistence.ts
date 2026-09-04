import type { DailyRecord } from '@/types/domain/dailyRecord';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  applyLocalPersistenceFailure,
  markLocalWriteSucceeded,
} from '@/services/repositories/dailyRecordRemotePersistenceState';
import type { RemoteWriteState } from '@/services/repositories/dailyRecordWriteState';

export const persistConfirmedRemoteRecordLocally = async ({
  date,
  changedPaths,
  authoritativeRecord,
  remoteState,
  adoptRemoteAuthorityRecord,
  releaseLocalPreOutboxHold,
}: {
  date: string;
  changedPaths: string[];
  authoritativeRecord: DailyRecord;
  remoteState: RemoteWriteState;
  adoptRemoteAuthorityRecord?: (record: DailyRecord) => Promise<DailyRecord>;
  releaseLocalPreOutboxHold?: () => Promise<void>;
}): Promise<boolean> => {
  if (adoptRemoteAuthorityRecord) {
    try {
      remoteState.localProjectionRecord = await adoptRemoteAuthorityRecord(authoritativeRecord);
    } catch (error) {
      await releaseLocalPreOutboxHold?.();
      applyLocalPersistenceFailure(
        date,
        changedPaths,
        {
          ok: false,
          operation: 'save',
          store: 'none',
          dates: [date],
          error,
          userSafeMessage:
            'El cambio quedó confirmado en el servidor, pero la cola local no pudo reconciliarse.',
        },
        remoteState,
        { remoteCommitted: true }
      );
      return false;
    }
  } else {
    const localResult = await saveToIndexedDB(authoritativeRecord);
    if (!localResult.ok) {
      await releaseLocalPreOutboxHold?.();
      applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState, {
        remoteCommitted: true,
      });
      return false;
    }
  }

  markLocalWriteSucceeded(remoteState);
  return true;
};
