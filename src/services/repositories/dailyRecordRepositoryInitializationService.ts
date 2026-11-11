import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  getForDate,
  getForDateWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { save, updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import {
  buildInitializedDayRecord,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordInitializationSupport';
import {
  createCopySourceInitializationSeed,
  createFreshInitializationSeed,
  DailyRecordInitializationSeed,
  shouldReturnSeedRecord,
} from '@/services/repositories/dailyRecordInitializationSeed';
import { createCopyPatientToDateCommand } from '@/services/repositories/contracts/dailyRecordLifecycleCommands';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  createCopyPatientResult,
  createInitializeDayResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { resolveRemoteGoldenPathReadResult } from './dailyRecordRemoteReadController';
import { captureLocalRecordBase } from '@/services/storage/indexeddb/indexedDbRecordService';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

export interface DailyRecordInitializationOptions {
  /** Automated preparation must never infer absence from a failed or cached read. */
  requireConfirmedAbsence?: boolean;
}

export interface DailyRecordInitializationResult {
  record: DailyRecord;
  outcome: 'clean' | 'repaired';
  sourceDate?: string;
  sourceCompatibilityIntensity:
    | 'none'
    | 'normalized_only'
    | 'legacy_staff_promoted'
    | 'legacy_schema_bridge';
  sourceMigrationRulesApplied: string[];
}

export interface CopyPatientToDateResult {
  sourceDate: string;
  targetDate: string;
  sourceBedId: string;
  targetBedId: string;
  outcome: 'clean' | 'repaired';
  sourceCompatibilityIntensity:
    | 'none'
    | 'normalized_only'
    | 'legacy_staff_promoted'
    | 'legacy_schema_bridge';
  sourceMigrationRulesApplied: string[];
}

const loadCopySourceRecord = async (copyFromDate?: string): Promise<DailyRecord | null> => {
  if (!copyFromDate) return null;
  return getForDate(copyFromDate);
};

const buildCopySourceMeta = (
  copySourceRecord: DailyRecord | null,
  copyFromDate?: string
): Omit<DailyRecordInitializationResult, 'record'> => {
  if (!copySourceRecord) {
    return {
      outcome: 'clean',
      sourceDate: copyFromDate,
      sourceCompatibilityIntensity: 'none',
      sourceMigrationRulesApplied: [],
    };
  }

  const migration = migrateLegacyDataWithReport(copySourceRecord, copySourceRecord.date);
  return {
    outcome:
      migration.compatibilityIntensity !== 'none' && migration.appliedRules.length > 0
        ? 'repaired'
        : 'clean',
    sourceDate: copySourceRecord.date,
    sourceCompatibilityIntensity: migration.compatibilityIntensity,
    sourceMigrationRulesApplied: migration.appliedRules,
  };
};

const loadRemoteInitializationSeed = async (
  date: string,
  allowOfflineCopy: boolean
): Promise<DailyRecordInitializationSeed | null> => {
  const base = await captureLocalRecordBase(date);
  let remoteResult;
  try {
    remoteResult = await loadRemoteRecordWithFallback(date, { base });
  } catch (error) {
    if (allowOfflineCopy && typeof navigator !== 'undefined' && !navigator.onLine) return null;
    throw error;
  }
  if (!remoteResult.record && !remoteResult.serverConfirmed)
    throw new Error(
      'No se pudo confirmar la ausencia del día con el servidor. Reintente con conexión.'
    );
  const result = await resolveRemoteGoldenPathReadResult({
    date,
    localCandidate: null,
    remoteReadResult: remoteResult,
    base: remoteResult.issuedAgainst ?? base,
  });
  if (result.publication === 'superseded' && !result.record)
    throw new ConcurrencyError('El censo cambió durante su apertura. Vuelva a abrir el día.');
  return result.record
    ? {
        record: result.record,
        source: 'local_current',
        compatibilityTier: result.compatibilityTier,
        compatibilityIntensity: result.compatibilityIntensity,
      }
    : null;
};

const resolveInitializationSeed = async (
  date: string,
  copySourceRecord: DailyRecord | null,
  options: DailyRecordInitializationOptions,
  allowOfflineCopy: boolean
): Promise<DailyRecordInitializationSeed> => {
  if (isFirestoreEnabled()) {
    const remoteSeed = await loadRemoteInitializationSeed(
      date,
      allowOfflineCopy && !options.requireConfirmedAbsence
    );
    if (remoteSeed?.record) {
      return remoteSeed;
    }
  } else if (options.requireConfirmedAbsence) {
    throw new Error(
      'No se pudo confirmar la ausencia del día con el servidor. Reintente con conexión.'
    );
  }

  if (copySourceRecord) {
    return createCopySourceInitializationSeed(copySourceRecord);
  }

  return createFreshInitializationSeed();
};

const loadExistingDailyRecord = async (date: string): Promise<DailyRecord | null> =>
  getForDate(date);

const resolveTargetRecordForCopy = async (targetDate: string): Promise<DailyRecord> => {
  const targetRecord = await getForDate(targetDate).catch(error => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    throw error;
  });
  return targetRecord ?? initializeMissingDay(targetDate, undefined, undefined, {}, true);
};

const initializeMissingDay = async (
  date: string,
  copyFromDate?: string,
  copySourceRecordOverride?: DailyRecord | null,
  options: DailyRecordInitializationOptions = {},
  allowOfflineCopy = false
): Promise<DailyRecord> => {
  const copySourceRecord =
    copySourceRecordOverride === undefined
      ? await loadCopySourceRecord(copyFromDate)
      : copySourceRecordOverride;
  const initializationSeed = await resolveInitializationSeed(
    date,
    copySourceRecord,
    options,
    allowOfflineCopy
  );

  if (shouldReturnSeedRecord(initializationSeed)) {
    return initializationSeed.record;
  }

  // Built field by field from the source: the new day never inherits the source's marker.
  let newRecord = buildInitializedDayRecord(date, initializationSeed.record);
  if (initializationSeed.record) {
    const { applyClinicalDayCarryover, readClinicalCarryoverSource } =
      await import('./clinicalDayCarryover');
    newRecord = applyClinicalDayCarryover(
      newRecord,
      await readClinicalCarryoverSource(date, initializationSeed.record)
    );
  }

  await save(newRecord, '');
  return newRecord;
};

export const initializeDay = async (
  date: string,
  copyFromDate?: string,
  options: DailyRecordInitializationOptions = {}
): Promise<DailyRecord> => (await initializeDayDetailed(date, copyFromDate, options)).record;

export const initializeDayDetailed = async (
  date: string,
  copyFromDate?: string,
  options: DailyRecordInitializationOptions = {}
): Promise<DailyRecordInitializationResult> =>
  measureRepositoryOperation(
    'dailyRecord.initializeDay',
    async () => {
      const offlineCopy =
        Boolean(copyFromDate) &&
        !options.requireConfirmedAbsence &&
        typeof navigator !== 'undefined' &&
        !navigator.onLine;
      const existing = await loadExistingDailyRecord(date).catch(error => {
        if (offlineCopy) return null;
        throw error;
      });
      if (existing) {
        return {
          record: existing,
          ...createInitializeDayResult({ date, outcome: 'clean', sourceDate: copyFromDate }),
          sourceCompatibilityIntensity: 'none',
          sourceMigrationRulesApplied: [],
        };
      }

      const copySourceRecord = copyFromDate ? await loadCopySourceRecord(copyFromDate) : null;
      const copyMeta = buildCopySourceMeta(copySourceRecord, copyFromDate);
      const record = await initializeMissingDay(
        date,
        copyFromDate,
        copySourceRecord,
        options,
        offlineCopy
      );
      return {
        record,
        ...createInitializeDayResult({
          date,
          outcome: copyMeta.outcome,
          sourceDate: copyMeta.sourceDate,
        }),
        ...copyMeta,
      };
    },
    { thresholdMs: 180, context: `${date}${copyFromDate ? `<-${copyFromDate}` : ''}` }
  );

export const copyPatientToDate = async (
  sourceDate: string,
  sourceBedId: string,
  targetDate: string,
  targetBedId: string
): Promise<void> => {
  await copyPatientToDateDetailed(sourceDate, sourceBedId, targetDate, targetBedId);
};

export const copyPatientToDateDetailed = async (
  sourceDate: string,
  sourceBedId: string,
  targetDate: string,
  targetBedId: string
): Promise<CopyPatientToDateResult> => {
  const command = createCopyPatientToDateCommand(sourceDate, sourceBedId, targetDate, targetBedId);
  const sourceResult = await getForDateWithMeta(command.sourceDate);
  const sourceRecord = sourceResult.record;
  if (!sourceRecord) throw new Error(`Source record for ${command.sourceDate} not found`);

  const sourcePatient = sourceRecord.beds[command.sourceBedId];
  if (!sourcePatient || !sourcePatient.patientName) {
    throw new Error(`No patient found in bed ${command.sourceBedId} on ${command.sourceDate}`);
  }

  await resolveTargetRecordForCopy(command.targetDate);
  const targetBedPatch = {
    [`beds.${command.targetBedId}`]: preparePatientForCarryover(sourcePatient, command.targetBedId),
  } as DailyRecordPatch;
  await updatePartial(command.targetDate, targetBedPatch);

  return {
    ...createCopyPatientResult({
      sourceDate: command.sourceDate,
      targetDate: command.targetDate,
      outcome:
        sourceResult.compatibilityIntensity !== 'none' &&
        sourceResult.migrationRulesApplied.length > 0
          ? 'repaired'
          : 'clean',
    }),
    sourceBedId: command.sourceBedId,
    targetBedId: command.targetBedId,
    sourceCompatibilityIntensity: sourceResult.compatibilityIntensity,
    sourceMigrationRulesApplied: sourceResult.migrationRulesApplied,
  };
};
