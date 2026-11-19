import { getForDate } from './dailyRecordRepositoryReadService';

import { isClinicalEventsOnlyDailyRecordPatch } from './dailyRecordClinicalDomainService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { getRecordForDateStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
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
  type SaveDailyRecordOptions,
} from '@/services/repositories/contracts/dailyRecordCommands';
import {
  buildDailyRecordSyncContract,
  resolveRecordBaseRevision,
} from '@/services/storage/sync/syncTaskContractPolicy';
import {
  queueDailyRecordSyncTaskWithLocalRecord,
  completeDirectDailyRecordSyncTask,
} from '@/services/storage/sync';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import {
  assertNoPatientErasures,
  runRemoteSaveIntegrityCheck,
} from '@/services/repositories/dailyRecordRemoteWriteController';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';
import { syncPatientsToMasterInBackground } from '@/services/repositories/dailyRecordBackgroundMasterSyncController';
import { resolveBlockingFieldShrinkages } from '@/services/repositories/dailyRecordFieldShrinkageGuard';
import {
  buildBlockedWriteResult,
  settleWriteResult,
  startWriteResult,
} from '@/services/repositories/dailyRecordWriteState';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  buildFieldShrinkageBlockedPartialUpdateResult,
  buildMissingBasePartialUpdateResult,
} from '@/services/repositories/dailyRecordPartialUpdateBlockingController';
import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';
import { buildGranularPatchStaleVersionRetryHooks } from '@/services/repositories/dailyRecordStaleVersionRebase';
import { buildPreOutboxRemoteAckOptions } from '@/services/repositories/dailyRecordPreOutboxRemoteAckPolicy';
import { buildPreOutboxRemoteAckCallbacks } from '@/services/repositories/dailyRecordPreOutboxRemoteAckCallbacks';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { AdmissionDatePolicyViolationError } from '@/domain/clinical-episode/admissionDatePolicy';
import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';
import { isMovementReclassificationPatch } from '@/domain/movements/movementReclassificationConcurrencyPolicy';
import { runWithDailyRecordWriteLock } from '@/services/repositories/dailyRecordWriteCoordinator';
import { assertDailyRecordRepositoryWriteAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';
import {
  buildGuardedDailyRecordPatchPolicy,
  buildGuardedDailyRecordRemoteWriteOptions,
  canRebaseManualSpecialtyIntent,
} from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import { adoptAuthoritativeRecord } from '@/services/repositories/dailyRecordRepositorySyncService';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { resolveUnsentDayBase } from '@/services/storage/sync/plainDayFieldReplay';
import { isValidRemoteAuthorityRecord } from '@/services/repositories/dailyRecordRemotePersistenceState';
import { assertAuthoringSessionCurrent } from '@/services/storage/authoringSession';

/** Stored here with its queue task, which sends it by itself. */
const queuedHereResult = (
  date: string,
  cause: 'retrying' | 'merged',
  userSafeMessage?: string
): DailyRecordWriteResult =>
  settleWriteResult(
    { ...startWriteResult(date), savedHere: true },
    { state: 'local', cause },
    { userSafeMessage }
  );

/** `null`: no merge. A merge means the queue stored the merged day here with its task. */
const tryAutoMergeBlockedFullSaveRegression = async (
  date: string,
  record: DailyRecord,
  authoringSession: SaveDailyRecordOptions['authoringSession']
): Promise<DailyRecordWriteResult | null> => {
  const mergeResult = await attemptConflictAutoMergeRecovery(date, record, ['*'], authoringSession);
  if (mergeResult?.status !== 'auto_merged') return null;
  return queuedHereResult(
    date,
    'merged',
    'Se detectó una posible pérdida de datos y se fusionó automáticamente con la copia remota.'
  );
};
const resolvePartialUpdateBaseRecord = async (
  date: string,
  options: PartialUpdateDailyRecordOptions
): Promise<DailyRecord | null> => {
  if (options.baseRecord?.date === date) {
    if (options.specialtyIntent?.kind === 'manual') {
      // A preceding write in this date's turn may already have adopted a newer day locally.
      // This is only a proposed CAS base: the server still confirms the episode and decision.
      let localRecord: DailyRecord | null;
      try {
        localRecord = await getRecordForDateStrict(date);
      } catch {
        try {
          localRecord = await getRecordForDateStrict(date);
        } catch {
          // The explicit caller base is a CAS proposal, never evidence of local absence.
          // Manual specialty policy requires atomic remote authority and its committed receipt;
          // stale revisions and changed episodes/decisions cannot overwrite the server.
          return options.baseRecord;
        }
      }
      if (
        isValidRemoteAuthorityRecord(localRecord, date) &&
        (resolveRecordBaseRevision(localRecord) ?? -1) >
          (resolveRecordBaseRevision(options.baseRecord) ?? -1) &&
        canRebaseManualSpecialtyIntent(options.specialtyIntent, options.baseRecord, localRecord)
      ) {
        return localRecord;
      }
    }
    return options.baseRecord;
  }

  return getForDate(date);
};

const saveDetailedWithinLock = async (
  record: DailyRecord,
  expectedLastUpdated: string | undefined,
  options: SaveDailyRecordOptions
) => {
  const command = createSaveDailyRecordCommand(record, expectedLastUpdated ?? record.lastUpdated);
  let validatedRecord: DailyRecord = command.record;
  try {
    const currentLocalRecord = await getRecordForDateStrict(command.date);
    validatedRecord = prepareDailyRecordForPersistence(
      command.record,
      command.date,
      currentLocalRecord
    );
    if (options.rayenStructuralWriteGuard) {
      const { assertWholeRecordNoteBase } =
        await import('@/services/storage/sync/dexieDailyRecordOutbox');
      await assertWholeRecordNoteBase(validatedRecord, options.baseRecord);
    }
    if (!options.deferRemoteSync) await runRemoteSaveIntegrityCheck(command.date, validatedRecord);
  } catch (err) {
    const merged =
      err instanceof DataRegressionError &&
      !options.deferRemoteSync &&
      !options.rayenStructuralWriteGuard &&
      validatedRecord
        ? await tryAutoMergeBlockedFullSaveRegression(
            command.date,
            validatedRecord,
            options.authoringSession
          )
        : null;
    if (merged) return merged;

    if (
      err instanceof DataRegressionError ||
      err instanceof VersionMismatchError ||
      err instanceof AdmissionDatePolicyViolationError
    ) {
      return buildBlockedWriteResult(command.date, err.message, err);
    }
    throw err;
  }

  const syncContract = buildDailyRecordSyncContract(validatedRecord, {
    expectedVersion: command.expectedLastUpdated,
    changedPaths: ['*'],
  });
  if (options.deferRemoteSync) {
    if (options.writeOrigin !== 'backup_restore')
      throw new Error('Deferred save requires backup origin');
    const queued = await queueDailyRecordSyncTaskWithLocalRecord(
      validatedRecord,
      {
        contexts: command.contexts,
        origin: 'backup_restore',
        syncContract,
      },
      {
        deferProcessing: true,
        wholeRecordBase: options.baseRecord,
        authoringSession: options.authoringSession,
      }
    );
    if (!queued.accepted) throw new Error('No fue posible guardar el respaldo junto a su envío.');
    return queuedHereResult(command.date, 'retrying');
  }
  const { result, next } = await persistLocalAndAttemptRemoteSync({
    change: {
      date: command.date,
      record: validatedRecord,
      changedPaths: ['*'],
      expectedVersion: command.expectedLastUpdated,
    },
    authoringSession: options.authoringSession,
    remote: {
      remoteWrite: () =>
        saveRecordToFirestore(validatedRecord, command.expectedLastUpdated, {
          syncContract,
          returnCommittedRecord: options.requireConfirmedRecord,
          origin: options.writeOrigin,
          // An automated structural import overwrites the day: keep the state it replaces.
          ...(options.rayenStructuralWriteGuard || options.historyPolicy === 'snapshot'
            ? { historyPolicy: 'snapshot' as const }
            : {}),
          assertSafeOverwrite: remoteData =>
            assertNoPatientErasures(docToRecord(remoteData, command.date), validatedRecord),
          assertCanPublish: () => assertAuthoringSessionCurrent(options.authoringSession),
        }),
      readRemoteConfirmedRecord: () => getRecordFromFirestore(command.date, { source: 'server' }),
      onRemoteFailure: err =>
        dailyRecordWriteLogger.warn(
          `Firestore sync failed for ${command.date}; data persisted in IndexedDB`,
          err
        ),
    },
    outbox: {
      queueLocalBeforeRemote: () =>
        queueDailyRecordSyncTaskWithLocalRecord(
          validatedRecord,
          {
            contexts: ['clinical', 'staffing', 'movements', 'handoff', 'metadata'],
            origin: options.writeOrigin === 'backup_restore' ? 'backup_restore' : 'direct_queue',
            syncContract,
          },
          {
            ...buildPreOutboxRemoteAckOptions(syncContract),
            wholeRecordBase: options.baseRecord,
            authoringSession: options.authoringSession,
          }
        ),
      ...buildPreOutboxRemoteAckCallbacks(validatedRecord, syncContract),
      completeConfirmedLocalWrite: confirmedRecord =>
        completeDirectDailyRecordSyncTask({
          sentRecord: validatedRecord,
          confirmedRecord,
          syncContract,
        }),
    },
    policy: {
      requireConfirmedRecord: options.requireConfirmedRecord,
      allowConflictAutoMerge: !options.rayenStructuralWriteGuard,
      remoteAuthorityFirst: Boolean(options.rayenStructuralWriteGuard),
    },
  });
  if (next === 'continue') syncPatientsToMasterInBackground(validatedRecord);
  return result;
};

export const saveDetailed = (
  record: DailyRecord,
  expectedLastUpdated: string | undefined,
  options: SaveDailyRecordOptions
) =>
  runWithDailyRecordWriteLock(record.date, options.dailyRecordWriteLease, () =>
    saveDetailedWithinLock(record, expectedLastUpdated, options)
  );

export const save = async (...args: Parameters<typeof saveDetailed>): Promise<void> =>
  assertDailyRecordRepositoryWriteAccepted(await saveDetailed(...args));

const updatePartialDetailedWithinLock = async (
  date: string,
  partialData: DailyRecordPatch,
  options: PartialUpdateDailyRecordOptions
) => {
  const command = createPartialUpdateDailyRecordCommand(date, partialData);
  let current = await resolvePartialUpdateBaseRecord(command.date, options);

  if (!current) {
    dailyRecordWriteLogger.warn(`No record found for ${command.date}; partial update aborted`);
    return buildMissingBasePartialUpdateResult(command.date);
  }

  // Try the observed version first. The authority transaction owns CAS and the episode/decision
  // check; a technical version conflict already has one guarded fresh-read/rebase below.
  if (options.specialtyIntent?.kind === 'manual') {
    if (!isFirestoreEnabled()) {
      throw new Error('La autoridad remota no está disponible para esta escritura clínica.');
    }
    const observedRecord = current;
    if (resolveRecordBaseRevision(current) === undefined) {
      const remoteRecord = await getRecordFromFirestore(command.date, { source: 'server' });
      if (!isValidRemoteAuthorityRecord(remoteRecord, command.date)) {
        throw new Error('No se pudo verificar la versión remota del censo. Vuelve a intentarlo.');
      }
      current = remoteRecord;
    }
    if (!canRebaseManualSpecialtyIntent(options.specialtyIntent, observedRecord, current)) {
      throw new ConcurrencyError(
        'El paciente o su especialidad cambió. Revisa el censo antes de volver a elegir.',
        'semantic_conflict'
      );
    }
  }

  let validatedRecord: DailyRecord;
  let mergedPatches: DailyRecordPatch;
  try {
    ({ record: validatedRecord, mergedPatches } = preparePatchedRecordPersistence(
      current,
      command.date,
      command.patch
    ));
  } catch (err) {
    if (err instanceof AdmissionDatePolicyViolationError) {
      return buildBlockedWriteResult(command.date, err.message, err);
    }
    throw err;
  }
  const semanticChangedPaths = Object.keys(command.patch);
  const syncContract = buildDailyRecordSyncContract(validatedRecord, {
    expectedVersion: current.lastUpdated,
    changedPaths: semanticChangedPaths,
  });
  const guardedCommandPolicy = buildGuardedDailyRecordPatchPolicy({
    patch: command.patch,
    mergedPatches,
    baseRecord: current,
    options,
    readRemoteRecord: () => getRecordFromFirestore(command.date, { source: 'server' }),
    mutationId: syncContract.mutationId,
  });
  const isReclassification = isMovementReclassificationPatch(command.patch);
  const clinicalEventsOnlyPatch = isClinicalEventsOnlyDailyRecordPatch(command.patch);
  const remoteWriteOptions = buildGuardedDailyRecordRemoteWriteOptions({
    options,
    policy: guardedCommandPolicy,
    syncContract,
    isReclassification,
    baseRecord: current,
  });

  // Server-first and atomic writes keep their exact base; a bed field's stale version is rebased
  // below against the same unsent base.
  const unsentBase =
    remoteWriteOptions.requireAtomicCas ||
    guardedCommandPolicy.remoteAuthorityFirst ||
    clinicalEventsOnlyPatch
      ? undefined
      : await resolveUnsentDayBase(command.date, current, semanticChangedPaths);
  if (unsentBase) remoteWriteOptions.baseRecord = unsentBase.baseRecord;
  // The outbox applies this patch again on the day's stored projection (#1024).
  const patchWrite = {
    baseRecord: current,
    patch: command.patch,
    prepare: (record: DailyRecord, patch: DailyRecordPatch) =>
      preparePatchedRecordPersistence(record, command.date, patch).record,
  };
  const suspiciousShrinkages = await resolveBlockingFieldShrinkages(
    command.date,
    current,
    mergedPatches
  );
  if (suspiciousShrinkages.length > 0) {
    return buildFieldShrinkageBlockedPartialUpdateResult(command.date, suspiciousShrinkages);
  }

  const { result } = await persistLocalAndAttemptRemoteSync({
    change: {
      date: command.date,
      record: validatedRecord,
      changedPaths: semanticChangedPaths,
      expectedVersion: current.lastUpdated,
    },
    authoringSession: options.authoringSession,
    remote: {
      remoteWrite: () =>
        updateRecordPartialToFirestore(
          command.date,
          guardedCommandPolicy.remoteAuthorityPatch,
          unsentBase?.expectedVersion ?? current.lastUpdated,
          remoteWriteOptions
        ),
      readRemoteConfirmedRecord: () => getRecordFromFirestore(command.date, { source: 'server' }),
      onRemoteFailure: err =>
        dailyRecordWriteLogger.warn(`Firestore partial update failed for ${command.date}`, err),
    },
    outbox: {
      queueLocalBeforeRemote: () =>
        queueDailyRecordSyncTaskWithLocalRecord(
          validatedRecord,
          {
            contexts: classifyConflictChangedContexts(semanticChangedPaths),
            origin: 'direct_queue',
            syncContract,
          },
          {
            ...buildPreOutboxRemoteAckOptions(syncContract),
            patchWrite,
            authoringSession: options.authoringSession,
          }
        ),
      ...buildPreOutboxRemoteAckCallbacks(validatedRecord, syncContract),
    },
    adoption: {
      resolveAlreadyAppliedRemoteRecord: guardedCommandPolicy.resolveAlreadyAppliedRemoteRecord,
      adoptRemoteAuthorityRecord: authoritativeRecord =>
        adoptAuthoritativeRecord(
          authoritativeRecord,
          guardedCommandPolicy.buildLocalAdoptionPatch(authoritativeRecord)
        ),
    },
    staleVersion: buildGranularPatchStaleVersionRetryHooks({
      date: command.date,
      options,
      policy: guardedCommandPolicy,
      isReclassification,
      semanticChangedPaths,
      baseRecord: current,
      unsentBaseRecord: unsentBase?.baseRecord,
      syncContract,
    }),
    policy: {
      requireConfirmedRecord: guardedCommandPolicy.requireConfirmedRecord,
      allowConflictAutoMerge:
        !isReclassification &&
        !options.specialtyIntent &&
        !options.requireAtomicCas &&
        !guardedCommandPolicy.requireAtomicCas,
      remoteAuthorityFirst: guardedCommandPolicy.remoteAuthorityFirst,
    },
  });
  return result;
};

export const updatePartialDetailed = (
  date: string,
  partialData: DailyRecordPatch,
  options: PartialUpdateDailyRecordOptions
) =>
  runWithDailyRecordWriteLock(date, options.dailyRecordWriteLease, () =>
    updatePartialDetailedWithinLock(date, partialData, options)
  );
export const updatePartial = async (
  ...args: Parameters<typeof updatePartialDetailed>
): Promise<void> => assertDailyRecordRepositoryWriteAccepted(await updatePartialDetailed(...args));
