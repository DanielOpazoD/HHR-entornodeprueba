import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  deleteRecordStrict as deleteFromIndexedDB,
  type LocalRecordWriteResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  deleteRecordFromFirestore,
  getRecordFromFirestore,
  moveRecordToTrash,
} from '../storage/firestore';
import { dailyRecordLifecycleLogger } from '@/services/repositories/repositoryLoggers';
import { isFirestoreEnabled } from './repositoryConfig';
import { createDeleteDayCommand } from './contracts/dailyRecordLifecycleCommands';
import { runExclusiveDailyRecordWrite } from './dailyRecordWriteCoordinator';

export const DAILY_RECORD_DELETE_OUTBOX_POLICY = {
  requiresTransactionalOutbox: false,
  remoteMode: 'best_effort_soft_delete',
  localRequirement: 'strict_local_delete_before_remote_cleanup',
  rationale: [
    'delete_day is a lifecycle/admin cleanup, not a clinical offline-first mutation',
    'the local delete must be strict so UI state does not pretend an unsafe delete succeeded',
    'remote moveToTrash/delete is already non-blocking and logged by lifecycle support',
  ],
  reviewTriggers: [
    'offline_delete_required',
    'delete_visible_as_clinical_workflow',
    'remote_delete_audit_must_be_exactly_once',
    'support_needs_retryable_trash_reconciliation',
  ],
} as const;

export const shouldQueueDailyRecordDeleteOutbox = (): boolean =>
  DAILY_RECORD_DELETE_OUTBOX_POLICY.requiresTransactionalOutbox;

export const assertDailyRecordDeleteOutboxPolicy = (): void => {
  if (!shouldQueueDailyRecordDeleteOutbox()) {
    return;
  }

  throw new Error(
    'delete/moveToTrash requires an explicit tombstone outbox before transactional delete queueing can be enabled.'
  );
};

interface RemoteDeleteDependencies {
  isRemoteEnabled: boolean;
  loadRecord: (date: string) => Promise<DailyRecord | null>;
  moveToTrash: (record: DailyRecord) => Promise<void>;
  deleteRemote: (date: string) => Promise<void>;
}

export const softDeleteDailyRecordRemote = async (
  date: string,
  dependencies: RemoteDeleteDependencies
): Promise<void> => {
  if (!dependencies.isRemoteEnabled) {
    return;
  }

  try {
    const record = await dependencies.loadRecord(date);
    if (record) {
      await dependencies.moveToTrash(record);
    }

    await dependencies.deleteRemote(date);
  } catch (error) {
    dailyRecordLifecycleLogger.error('Failed to soft-delete from Firestore', error);
  }
};

const toLocalDeleteError = (result: LocalRecordWriteResult): Error =>
  result.error instanceof Error
    ? result.error
    : new Error(result.userSafeMessage || 'No fue posible eliminar el registro local.');

export const deleteDailyRecordAcrossStores = async (date: string): Promise<void> =>
  runExclusiveDailyRecordWrite(date, async () => {
    assertDailyRecordDeleteOutboxPolicy();
    const command = createDeleteDayCommand(date);
    const localResult = await deleteFromIndexedDB(command.date);
    if (!localResult.ok) {
      throw toLocalDeleteError(localResult);
    }
    await softDeleteDailyRecordRemote(command.date, {
      isRemoteEnabled: isFirestoreEnabled(),
      loadRecord: getRecordFromFirestore,
      moveToTrash: moveRecordToTrash,
      deleteRemote: deleteRecordFromFirestore,
    });
  });
