import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  runExclusiveDailyRecordWrite,
  type DailyRecordWriteLease,
} from './dailyRecordWriteCoordinator';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import { isClinicalDerivedLayoutRegression } from '@/services/storage/clinicalDerivedImportGuard';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { assertDailyRecordRepositoryWriteAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';

/** D3 checks every date the file names (even if D10 skips it) and every date it will write. */
export const saveBackupImport = async (records: DailyRecord[], sourceDates: string[]) => {
  await ensureDbReady();
  const { session, check } = guardAuthoringSession({
    message: 'La sesión cambió durante la importación.',
  });
  const dates = [...new Set([...sourceDates, ...records.map(record => record.date)])].sort();
  const leases = new Map<string, DailyRecordWriteLease>();
  const lock = async (index: number): Promise<string[]> => {
    const date = dates.at(index);
    if (date)
      return runExclusiveDailyRecordWrite(date, async lease => {
        leases.set(date, lease);
        return lock(index + 1);
      });
    return hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      hospitalDB.settings,
      async () => {
        const tasks = await hospitalDB.syncQueue.toArray();
        const pendingDates = dates.filter(date =>
          tasks.some(
            task =>
              task.status !== 'RETIRED' &&
              task.type === 'UPDATE_DAILY_RECORD' &&
              (task.key === `daily:${date}` ||
                (typeof task.payload === 'object' &&
                  task.payload !== null &&
                  'date' in task.payload &&
                  task.payload.date === date))
          )
        );
        if (pendingDates.length) return pendingDates;
        for (const record of records) {
          check();
          if (
            isClinicalDerivedLayoutRegression(
              (await hospitalDB.dailyRecords.get(record.date)) ?? null,
              record
            )
          )
            throw new Error('El día local dividido cambió durante la importación.');
          const saved = await saveDetailed(record, record.lastUpdated, {
            authoringSession: session,
            writeOrigin: 'backup_restore',
            deferRemoteSync: true,
            dailyRecordWriteLease: leases.get(record.date),
          });
          assertDailyRecordRepositoryWriteAccepted(saved);
          if (!saved.savedHere) throw new Error('No fue posible guardar el respaldo local.');
        }
        check();
        return [];
      }
    );
  };
  return lock(0);
};
