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
  enrichInitializationRecordFromCopySource,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordInitializationSupport';
import {
  createCopySourceInitializationSeed,
  createFreshInitializationSeed,
  createRemoteInitializationSeed,
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
import { dailyRecordInitializationLogger } from '@/services/repositories/repositoryLoggers';
import { persistHydratedRecordToLocalCache } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';

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

const cacheInitializationRecordIfNeeded = async (
  record: DailyRecord,
  copySourceRecord: DailyRecord | null
): Promise<void> => {
  if (!copySourceRecord) {
    return;
  }

  try {
    await persistHydratedRecordToLocalCache(record, record.date);
  } catch (error) {
    if (error instanceof AdmissionDatePolicyViolationError) {
      dailyRecordInitializationLogger.warn(
        `Skipped initialization cache write for ${record.date} due to admissionDate validation`,
        error
      );
      return;
    }
    throw error;
  }
};

const loadRemoteInitializationSeed = async (
  date: string,
  copySourceRecord: DailyRecord | null
): Promise<DailyRecordInitializationSeed | null> => {
  try {
    const remoteResult = await loadRemoteRecordWithFallback(date);
    if (!remoteResult.record) return null;

    const enrichedRecord = enrichInitializationRecordFromCopySource(
      remoteResult.record,
      copySourceRecord
    );
    await cacheInitializationRecordIfNeeded(enrichedRecord, copySourceRecord);

    return createRemoteInitializationSeed({
      ...remoteResult,
      record: enrichedRecord,
    });
  } catch (err) {
    dailyRecordInitializationLogger.warn(
      `Failed to check remote sources for ${date} during init`,
      err
    );
    return null;
  }
};

const resolveInitializationSeed = async (
  date: string,
  copySourceRecord: DailyRecord | null
): Promise<DailyRecordInitializationSeed> => {
  if (isFirestoreEnabled()) {
    const remoteSeed = await loadRemoteInitializationSeed(date, copySourceRecord);
    if (remoteSeed?.record) {
      return remoteSeed;
    }
  }

  if (copySourceRecord) {
    return createCopySourceInitializationSeed(copySourceRecord);
  }

  return createFreshInitializationSeed();
};

const loadExistingDailyRecord = async (date: string): Promise<DailyRecord | null> =>
  getForDate(date);

const resolveTargetRecordForCopy = async (targetDate: string): Promise<DailyRecord> => {
  const targetRecord = await getForDate(targetDate);
  return targetRecord ?? initializeMissingDay(targetDate);
};

const initializeMissingDay = async (
  date: string,
  copyFromDate?: string,
  copySourceRecordOverride?: DailyRecord | null
): Promise<DailyRecord> => {
  const copySourceRecord =
    copySourceRecordOverride === undefined
      ? await loadCopySourceRecord(copyFromDate)
      : copySourceRecordOverride;
  const initializationSeed = await resolveInitializationSeed(date, copySourceRecord);

  if (shouldReturnSeedRecord(initializationSeed)) {
    return initializationSeed.record;
  }

  const newRecord = buildInitializedDayRecord(date, initializationSeed.record);

  await save(newRecord);
  return newRecord;
};

export const initializeDay = async (date: string, copyFromDate?: string): Promise<DailyRecord> =>
  (await initializeDayDetailed(date, copyFromDate)).record;

export const initializeDayDetailed = async (
  date: string,
  copyFromDate?: string
): Promise<DailyRecordInitializationResult> =>
  measureRepositoryOperation(
    'dailyRecord.initializeDay',
    async () => {
      const existing = await loadExistingDailyRecord(date);
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
      const record = await initializeMissingDay(date, copyFromDate, copySourceRecord);
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
