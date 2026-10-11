import {
  deleteRecordStrict as deleteFromIndexedDB,
  type LocalRecordWriteResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  deleteRecordFromFirestore,
  getRecordFromFirestore,
  moveRecordToTrash,
} from '../storage/firestore';
import { softDeleteDailyRecordRemote } from './dailyRecordRepositoryLifecycleSupport';
import { assertDailyRecordDeleteOutboxPolicy } from './dailyRecordDeleteOutboxPolicy';
import { isFirestoreEnabled } from './repositoryConfig';
import { createDeleteDayCommand } from './contracts/dailyRecordLifecycleCommands';
import { runExclusiveDailyRecordWrite } from './dailyRecordWriteCoordinator';

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
