import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  saveRecordToFirestore,
  updateRecordPartial as updateRecordPartialToFirestore,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  createPartialUpdateDailyRecordCommand,
  createSaveDailyRecordCommand,
  type PartialUpdateDailyRecordOptions,
} from '@/services/repositories/contracts/dailyRecordCommands';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { preparePatchedRecordForPersistence } from '@/services/repositories/dailyRecordPatchPreparation';
import {
  assertNoPatientErasures,
  assertRemoteSaveCompatibility,
} from '@/services/repositories/dailyRecordRemoteWriteController';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';
import { syncPatientsToMasterInBackground } from '@/services/repositories/dailyRecordBackgroundMasterSyncController';
import { resolveBlockingFieldShrinkages } from '@/services/repositories/dailyRecordFieldShrinkageGuard';
import {
  applyRecoveryDecisionToState,
  buildBlockedSaveResult,
  buildPartialUpdateResult,
  buildSaveResult,
  createRemoteWriteState,
  type RemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';
import {
  buildFieldShrinkageBlockedPartialUpdateResult,
  buildMissingBasePartialUpdateResult,
  buildValidationBlockedPartialUpdateResult,
} from '@/services/repositories/dailyRecordPartialUpdateBlockingController';
import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';
import { buildPreOutboxRemoteAckOptions } from '@/services/repositories/dailyRecordPreOutboxRemoteAckPolicy';
import { buildPreOutboxRemoteAckCallbacks } from '@/services/repositories/dailyRecordPreOutboxRemoteAckCallbacks';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { isMovementReclassificationPatch } from '@/application/census/movementReclassificationConcurrencyPolicy';

const runRemoteSaveIntegrityCheck = async (date: string, record: DailyRecord): Promise<void> => {
  if (!isFirestoreEnabled()) return;

  try {
    await assertRemoteSaveCompatibility(date, record);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'DataRegressionError' || err.name === 'VersionMismatchError')
    ) {
      throw err;
    }
    dailyRecordWriteLogger.warn('Could not perform integrity check, proceeding anyway', err);
  }
};

const tryAutoMergeBlockedFullSaveRegression = async (
  date: string,
  record: DailyRecord,
  error: DataRegressionError,
  state: RemoteWriteState
): Promise<boolean> => {
  const mergeResult = await attemptConflictAutoMergeRecovery(date, record, ['*']);
  if (mergeResult?.status !== 'auto_merged') {
    return false;
  }

  state.queuedForRetry = true;
  state.autoMerged = true;
  applyRecoveryDecisionToState(state, {
    consistencyState: 'auto_merged',
    retryability: 'automatic_retry',
    recoveryAction: 'auto_merge_and_queue',
    conflictSummary: {
      kind: 'regression_blocked',
      sourceOfTruth: 'local',
      localTimestamp: record.lastUpdated,
      changedPaths: ['*'],
      message: error.message,
    },
    observabilityTags: ['daily_record', 'write', 'regression_auto_merged'],
    userSafeMessage:
      'Se detectó una posible pérdida de datos y se fusionó automáticamente con la copia remota.',
  });
  return true;
};

const resolvePartialUpdateBaseRecord = async (
  date: string,
  options: PartialUpdateDailyRecordOptions = {}
): Promise<DailyRecord | null> => {
  if (options.baseRecord?.date === date) {
    return options.baseRecord;
  }

  const localRecord = await getRecordFromIndexedDB(date);
  if (localRecord) {
    return localRecord;
  }

  if (!isFirestoreEnabled()) {
    return null;
  }

  try {
    const remoteRecord = await getRecordFromFirestore(date);
    if (!remoteRecord) {
      return null;
    }

    const localResult = await saveToIndexedDB(remoteRecord);
    if (!localResult.ok) {
      throw localResult.error instanceof Error
        ? localResult.error
        : new Error(localResult.userSafeMessage || 'No fue posible guardar la base remota local.');
    }
    return remoteRecord;
  } catch (error) {
    dailyRecordWriteLogger.warn(
      `Remote base fetch failed for ${date}; partial update aborted`,
      error
    );
    return null;
  }
};

export const saveDetailed = async (record: DailyRecord, expectedLastUpdated?: string) => {
  const command = createSaveDailyRecordCommand(record, expectedLastUpdated ?? record.lastUpdated);
  const remoteState = createRemoteWriteState();
  let validatedRecord: DailyRecord = command.record;
  try {
    const currentLocalRecord = await getRecordFromIndexedDB(command.date);
    validatedRecord = prepareDailyRecordForPersistence(
      command.record,
      command.date,
      currentLocalRecord
    );
    await runRemoteSaveIntegrityCheck(command.date, validatedRecord);
  } catch (err) {
    if (
      err instanceof DataRegressionError &&
      validatedRecord &&
      (await tryAutoMergeBlockedFullSaveRegression(command.date, validatedRecord, err, remoteState))
    ) {
      return buildSaveResult(command.date, remoteState);
    }

    if (
      err instanceof DataRegressionError ||
      err instanceof VersionMismatchError ||
      err instanceof AdmissionDatePolicyViolationError
    ) {
      applyRecoveryDecisionToState(
        remoteState,
        {
          consistencyState:
            err instanceof DataRegressionError
              ? 'blocked_regression'
              : err instanceof VersionMismatchError
                ? 'blocked_version_mismatch'
                : 'blocked_validation',
          retryability: 'blocked',
          recoveryAction: 'block_and_surface',
          blockingReason:
            err instanceof DataRegressionError
              ? 'regression'
              : err instanceof VersionMismatchError
                ? 'version_mismatch'
                : 'validation',
          conflictSummary: {
            kind:
              err instanceof DataRegressionError
                ? 'regression_blocked'
                : err instanceof VersionMismatchError
                  ? 'version_mismatch'
                  : 'validation_blocked',
            sourceOfTruth: 'none',
            message: err.message,
          },
          observabilityTags: [
            'daily_record',
            'write',
            err instanceof DataRegressionError
              ? 'regression_blocked'
              : err instanceof VersionMismatchError
                ? 'version_mismatch'
                : 'validation_blocked',
          ],
          userSafeMessage: err.message,
        },
        err
      );
      return buildBlockedSaveResult(command.date, remoteState);
    }
    throw err;
  }

  const syncContract = buildDailyRecordSyncContract(validatedRecord, {
    expectedVersion: command.expectedLastUpdated,
    changedPaths: ['*'],
  });
  const nextAction = await persistLocalAndAttemptRemoteSync({
    date: command.date,
    record: validatedRecord,
    changedPaths: ['*'],
    remoteState,
    remoteWrite: () =>
      saveRecordToFirestore(validatedRecord, command.expectedLastUpdated, {
        syncContract,
        // Atomic backstop: re-check inside the write transaction against the freshly-read remote,
        // so an erasure is blocked even if a patient was admitted after the pre-write check or
        // when no base version (expectedLastUpdated) is available to the optimistic CAS.
        assertSafeOverwrite: remoteData =>
          assertNoPatientErasures(docToRecord(remoteData, command.date), validatedRecord),
      }),
    queueLocalBeforeRemote: () =>
      queueDailyRecordSyncTaskWithLocalRecord(
        validatedRecord,
        {
          contexts: ['clinical', 'staffing', 'movements', 'handoff', 'metadata'],
          origin: 'direct_queue',
          syncContract,
        },
        buildPreOutboxRemoteAckOptions(syncContract)
      ),
    ...buildPreOutboxRemoteAckCallbacks(validatedRecord, syncContract),
    onRemoteFailure: err => {
      dailyRecordWriteLogger.warn(
        `Firestore sync failed for ${command.date}; data persisted in IndexedDB`,
        err
      );
    },
    expectedVersion: command.expectedLastUpdated,
  });
  if (nextAction === 'return') {
    return buildSaveResult(command.date, remoteState);
  }

  syncPatientsToMasterInBackground(validatedRecord);

  return buildSaveResult(command.date, remoteState);
};

export const save = async (record: DailyRecord, expectedLastUpdated?: string): Promise<void> => {
  const result = await saveDetailed(record, expectedLastUpdated);
  if (result.blockingError) {
    throw result.blockingError;
  }
};

export const updatePartialDetailed = async (
  date: string,
  partialData: DailyRecordPatch,
  options: PartialUpdateDailyRecordOptions = {}
) => {
  const command = createPartialUpdateDailyRecordCommand(date, partialData);
  const remoteState = createRemoteWriteState();
  const current = await resolvePartialUpdateBaseRecord(command.date, options);

  if (!current) {
    dailyRecordWriteLogger.warn(`No record found for ${command.date}; partial update aborted`);
    return buildMissingBasePartialUpdateResult({
      date: command.date,
      state: remoteState,
      patchedFields: Object.keys(command.patch).length,
    });
  }

  let validatedRecord: DailyRecord;
  let mergedPatches: DailyRecordPatch;
  try {
    ({ record: validatedRecord, mergedPatches } = preparePatchedRecordForPersistence(
      current,
      command.date,
      command.patch
    ));
  } catch (err) {
    if (err instanceof AdmissionDatePolicyViolationError) {
      return buildValidationBlockedPartialUpdateResult({
        date: command.date,
        state: remoteState,
        changedPaths: Object.keys(command.patch),
        error: err,
        patchedFields: Object.keys(command.patch).length,
      });
    }
    throw err;
  }
  const patchedFields = Object.keys(mergedPatches).length;
  const semanticChangedPaths = Object.keys(command.patch);
  const isReclassification = isMovementReclassificationPatch(command.patch);
  const syncContract = buildDailyRecordSyncContract(validatedRecord, {
    expectedVersion: current.lastUpdated,
    changedPaths: semanticChangedPaths,
  });

  const suspiciousShrinkages = await resolveBlockingFieldShrinkages(
    command.date,
    current,
    mergedPatches
  );
  if (suspiciousShrinkages.length > 0) {
    return buildFieldShrinkageBlockedPartialUpdateResult({
      date: command.date,
      state: remoteState,
      shrinkages: suspiciousShrinkages,
      patchedFields,
    });
  }

  const nextAction = await persistLocalAndAttemptRemoteSync({
    date: command.date,
    record: validatedRecord,
    changedPaths: semanticChangedPaths,
    remoteState,
    remoteWrite: () =>
      updateRecordPartialToFirestore(command.date, mergedPatches, current.lastUpdated, {
        syncContract,
        requireAtomicCas: isReclassification,
        ...(options.historyPolicy ? { historyPolicy: options.historyPolicy } : {}),
      }),
    queueLocalBeforeRemote: () =>
      queueDailyRecordSyncTaskWithLocalRecord(
        validatedRecord,
        {
          contexts: classifyConflictChangedContexts(semanticChangedPaths),
          origin: 'direct_queue',
          syncContract,
        },
        buildPreOutboxRemoteAckOptions(syncContract)
      ),
    ...buildPreOutboxRemoteAckCallbacks(validatedRecord, syncContract),
    onRemoteFailure: err => {
      dailyRecordWriteLogger.warn(`Firestore partial update failed for ${command.date}`, err);
    },
    expectedVersion: current.lastUpdated,
    allowConflictAutoMerge: !isReclassification,
  });
  if (nextAction === 'return') {
    return buildPartialUpdateResult(command.date, remoteState, patchedFields);
  }

  return buildPartialUpdateResult(command.date, remoteState, patchedFields);
};

export const updatePartial = async (date: string, partialData: DailyRecordPatch): Promise<void> => {
  const result = await updatePartialDetailed(date, partialData);
  if (result.blockingError) {
    throw result.blockingError;
  }
  if (result.outcome === 'blocked' || isDailyRecordWriteBlockedResult(result)) {
    throw new Error(
      resolveApplicationOutcomeMessage(
        result,
        'La actualización quedó bloqueada por una validación de consistencia.'
      )
    );
  }
};
