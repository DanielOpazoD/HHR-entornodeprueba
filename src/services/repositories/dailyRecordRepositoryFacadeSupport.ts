import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
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
import {
  createCopyPatientToDateCommand,
  createDeleteDayCommand,
  createInitializeDayCommand,
} from './contracts/dailyRecordLifecycleCommands';
import {
  createGetDailyRecordQuery,
  createGetPreviousDayQuery,
} from './contracts/dailyRecordQueries';
import {
  createPartialUpdateDailyRecordCommand,
  createSaveDailyRecordCommand,
} from './contracts/dailyRecordCommands';
import { runExclusiveDailyRecordWrite } from './dailyRecordWriteCoordinator';

export const buildDailyRecordQuery = (date: string, syncFromRemote = true) =>
  createGetDailyRecordQuery(date, syncFromRemote);

export const buildPreviousDayQuery = (date: string) => createGetPreviousDayQuery(date);

export const buildSaveDailyRecordCommand = (record: DailyRecord, expectedLastUpdated?: string) =>
  createSaveDailyRecordCommand(record, expectedLastUpdated);

export const buildPartialUpdateDailyRecordCommand = (date: string, patch: DailyRecordPatch) =>
  createPartialUpdateDailyRecordCommand(date, patch);

export const buildInitializeDayCommand = (date: string, copyFromDate?: string) =>
  createInitializeDayCommand(date, copyFromDate);

export const buildCopyPatientToDateCommand = (
  sourceDate: string,
  sourceBedId: string,
  targetDate: string,
  targetBedId: string
) => createCopyPatientToDateCommand(sourceDate, sourceBedId, targetDate, targetBedId);

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
