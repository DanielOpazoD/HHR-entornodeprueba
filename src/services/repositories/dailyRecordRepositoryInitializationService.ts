import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  getForDate,
  getForDateWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { save, updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  buildInitializedDayRecord,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordInitializationSupport';
import { createCopyPatientToDateCommand } from '@/services/repositories/contracts/dailyRecordLifecycleCommands';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  createCopyPatientResult,
  createInitializeDayResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
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

const captureInitializationSession = () => {
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  const isCurrent = () => owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch();
  const assertCurrentSession = () => {
    if (!isCurrent()) throw new ConcurrencyError('La sesión cambió durante la apertura del censo.');
  };
  return { assertCurrentSession, authoringSession: captureAuthoringSession() };
};

type InitializationSession = ReturnType<typeof captureInitializationSession>;

/**
 * The one read that decides whether a day must be created. A day found here, on the server or
 * still only on this computer, is returned as it is. Absence counts only when the server
 * confirmed it, or for a copy made while this computer is offline (CEN-01, SAVE-01).
 */
const readDayBeforeCreation = async (
  date: string,
  { requireConfirmedAbsence }: DailyRecordInitializationOptions,
  allowOfflineCopy: boolean,
  { assertCurrentSession }: InitializationSession
): Promise<DailyRecord | null> => {
  const offlineCopy = () =>
    allowOfflineCopy &&
    !requireConfirmedAbsence &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine;
  let read: Awaited<ReturnType<typeof getForDateWithMeta>>;
  try {
    read = await getForDateWithMeta(date);
  } catch (error) {
    assertCurrentSession();
    if (offlineCopy()) return null;
    throw error;
  }
  assertCurrentSession();
  if (read.record) return read.record;
  if (read.publication === 'superseded')
    throw new ConcurrencyError('El censo cambió durante su apertura. Vuelva a abrir el día.');
  const absenceConfirmed = isFirestoreEnabled() ? read.serverConfirmed : !requireConfirmedAbsence;
  if (absenceConfirmed || offlineCopy()) return null;
  throw new Error(
    'No se pudo confirmar la ausencia del día con el servidor. Reintente con conexión.'
  );
};

const resolveTargetRecordForCopy = async (targetDate: string): Promise<DailyRecord> => {
  const session = captureInitializationSession();
  const targetRecord = await readDayBeforeCreation(targetDate, {}, true, session);
  return targetRecord ?? initializeMissingDay(targetDate, null, session);
};

/** Builds a day the caller already confirmed missing, from the source day as read, and saves it. */
const initializeMissingDay = async (
  date: string,
  copySourceRecord: DailyRecord | null,
  { assertCurrentSession, authoringSession }: InitializationSession
): Promise<DailyRecord> => {
  // Built field by field from the source: the new day never inherits the source's marker.
  let newRecord = buildInitializedDayRecord(date, copySourceRecord);
  if (copySourceRecord) {
    const { applyClinicalDayCarryover, readClinicalCarryoverSource } =
      await import('./clinicalDayCarryover');
    newRecord = applyClinicalDayCarryover(
      newRecord,
      await readClinicalCarryoverSource(date, copySourceRecord)
    );
  }

  assertCurrentSession();
  await save(newRecord, '', { authoringSession });
  return newRecord;
};

/**
 * The copy source is the source day's date, read here only when the day is missing, or the source
 * day its caller has already read, which is then not read again.
 */
type CopySource = string | DailyRecord;

export const initializeDay = async (
  date: string,
  copySource?: CopySource,
  options: DailyRecordInitializationOptions = {}
): Promise<DailyRecord> => (await initializeDayDetailed(date, copySource, options)).record;

export const initializeDayDetailed = async (
  date: string,
  copySource?: CopySource,
  options: DailyRecordInitializationOptions = {}
): Promise<DailyRecordInitializationResult> => {
  const copyFromDate = typeof copySource === 'string' ? copySource : copySource?.date;
  return measureRepositoryOperation(
    'dailyRecord.initializeDay',
    async () => {
      const session = captureInitializationSession();
      const existing = await readDayBeforeCreation(date, options, Boolean(copySource), session);
      if (existing) {
        return {
          record: existing,
          ...createInitializeDayResult({ date, outcome: 'clean', sourceDate: copyFromDate }),
          sourceCompatibilityIntensity: 'none',
          sourceMigrationRulesApplied: [],
        };
      }

      const copySourceRecord =
        typeof copySource === 'string' ? await getForDate(copySource) : (copySource ?? null);
      session.assertCurrentSession();
      const copyMeta = buildCopySourceMeta(copySourceRecord, copyFromDate);
      const record = await initializeMissingDay(date, copySourceRecord, session);
      session.assertCurrentSession();
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
};

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
  const authoringSession = captureAuthoringSession();
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
  await updatePartial(command.targetDate, targetBedPatch, { authoringSession });

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
