import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import {
  classifyDailyRecordPatchContexts,
  classifyDailyRecordSaveContexts,
  type DailyRecordDomainContext,
} from './dailyRecordDomainContracts';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface SaveDailyRecordCommand {
  date: string;
  record: DailyRecord;
  expectedLastUpdated?: string;
  contexts: DailyRecordDomainContext[];
}

export interface PartialUpdateDailyRecordCommand {
  date: string;
  patch: DailyRecordPatch;
  contexts: DailyRecordDomainContext[];
}

export interface PartialUpdateDailyRecordOptions {
  /**
   * Fresh clinical base already resolved by the read/freshness pipeline.
   * Used by mutation paths that just hydrated remote truth so writes do not
   * fail solely because IndexedDB was cleared or not yet repopulated.
   */
  baseRecord?: DailyRecord | null;
  /**
   * Automated multi-patch jobs capture one record snapshot before their first successful write and
   * skip repeated multi-megabyte snapshots for the remaining patches in the same logical run.
   */
  historyPolicy?: 'snapshot' | 'skip';
  /**
   * Forces this Rayen clinical patch through an atomic remote policy check before it may enter
   * local persistence/outbox. Reserved for synchronization code; ordinary census edits omit it.
   */
  rayenClinicalWriteGuard?: RayenClinicalWriteGuard;
}

const assertDate = (date: string, operation: string): void => {
  if (!date || !ISO_DATE_REGEX.test(date)) {
    throw new Error(`[RepositoryContract] Invalid date format for ${operation}: "${date}"`);
  }
};

export const createSaveDailyRecordCommand = (
  record: DailyRecord,
  expectedLastUpdated?: string
): SaveDailyRecordCommand => {
  assertDate(record.date, 'save');
  return {
    date: record.date,
    record,
    expectedLastUpdated,
    contexts: classifyDailyRecordSaveContexts(),
  };
};

export const createPartialUpdateDailyRecordCommand = (
  date: string,
  patch: DailyRecordPatch
): PartialUpdateDailyRecordCommand => {
  assertDate(date, 'updatePartial');
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    throw new Error('[RepositoryContract] updatePartial requires at least one patch field');
  }
  return {
    date,
    patch,
    contexts: classifyDailyRecordPatchContexts(patch),
  };
};
