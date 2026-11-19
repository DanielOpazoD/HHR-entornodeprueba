import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  localCopyStale,
  storedHere,
  toWriteError,
} from '@/services/repositories/dailyRecordRemotePersistenceState';
import type { RemoteWriteStep } from '@/services/repositories/dailyRecordWriteState';

/** Stores the server-confirmed record here; `current` already says the server holds it. */
export const persistConfirmedRemoteRecordLocally = async ({
  current,
  authoritativeRecord,
  adoptRemoteAuthorityRecord,
  completeConfirmedLocalWrite,
  releaseLocalPreOutboxHold,
}: {
  current: DailyRecordWriteResult;
  authoritativeRecord: DailyRecord;
  adoptRemoteAuthorityRecord?: (record: DailyRecord) => Promise<DailyRecord>;
  completeConfirmedLocalWrite?: (record: DailyRecord) => Promise<DailyRecord | undefined>;
  releaseLocalPreOutboxHold?: () => Promise<void>;
}): Promise<RemoteWriteStep> => {
  const reconcile = completeConfirmedLocalWrite ?? adoptRemoteAuthorityRecord;
  if (reconcile) {
    let localProjectionRecord: DailyRecord | undefined;
    try {
      localProjectionRecord = await reconcile(authoritativeRecord);
    } catch (error) {
      await releaseLocalPreOutboxHold?.();
      const blockingError = toWriteError(
        error,
        'El cambio quedó confirmado en el servidor, pero la cola local no pudo reconciliarse.'
      );
      return { result: localCopyStale(current, blockingError), next: 'return' };
    }
    return { result: storedHere({ ...current, localProjectionRecord }), next: 'continue' };
  }

  const localResult = await saveToIndexedDB(authoritativeRecord);
  if (!localResult.ok) {
    await releaseLocalPreOutboxHold?.();
    const blockingError = toWriteError(
      localResult.error,
      localResult.userSafeMessage || 'No fue posible guardar el registro local.'
    );
    return { result: localCopyStale(current, blockingError), next: 'return' };
  }
  return { result: storedHere(current), next: 'continue' };
};
