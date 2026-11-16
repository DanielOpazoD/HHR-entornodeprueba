import { getDoc, Timestamp, type DocumentData } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { withRetry } from '@/utils/networkUtils';
import { loadFunctionsModule } from '@/services/firebase-runtime/functionsModuleLoader';
import { DataRegressionError } from '@/utils/integrityGuard';
import {
  docToRecord,
  getRecordDocRef,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';
import { isSpecialistScopedDailyRecordPatch } from '@/services/repositories/dailyRecordClinicalDomainService';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import {
  asFirestoreUpdatePayload,
  assertFirestoreConcurrency,
  ConcurrencyError,
  saveHistorySnapshot,
  saveRecordAtomically,
  updateRecordPartiallyAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';
import {
  projectFirestoreUpdate,
  UnsupportedFirestoreUpdateProjectionError,
} from '@/services/storage/firestore/firestoreUpdateProjection';
import { createOperationalError } from '@/services/observability/operationalError';
import {
  createFieldChangedElsewhereError,
  createSavedByQueueRouteError,
} from '@/services/storage/syncErrorCatalog';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import {
  isPermissionDeniedError,
  logFirestoreWriteError,
  logFirestoreWriteRetry,
  tryRefreshCurrentUserRoleClaim,
} from '@/services/storage/firestore/firestoreRecordWriteUtilities';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  saveDailyRecordWithClinicalAuthorityCallable,
  shouldRetryDailyRecordAuthorityError,
  type DailyRecordAuthorityCallableResponse,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import {
  assertDailyRecordClinicalAuthority,
  extractDailyRecordBedTreePatch,
  extractClinicalAuthorityPatch,
  isDailyRecordBedTreePath,
  STAFFING_PATH,
  resolveAuthenticatedDailyRecordAuthorityMode,
  shouldRouteDailyRecordSaveViaCallable,
  shouldRouteClinicalAuthorityPatch,
  shouldRouteStructuralBedPatchViaCallable,
  shouldRouteSpecialistPatchViaCallable,
  type DailyRecordPartialWriteOptions,
  type DailyRecordSaveWriteOptions,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  createDirectFirestoreWriteReceipt,
  type DirectFirestoreWriteReceipt,
} from './firestoreDirectWriteReceipt';
import { adoptStoredClinicalDerivedState } from '@/services/storage/clinicalDerivedWriteHygiene';
import { runPartialUpdatePersistWithPermissionFallbacks } from '@/services/storage/firestore/firestoreBedTreePermissionFallback';
import { stripInheritedAuthorityRepair } from '@/services/storage/firestore/firestoreInheritedRepairSeparation';
import {
  extractE2EForcedMovementAuthorityPatch,
  isE2EForcedMovementAuthorityPatch,
} from '@/services/storage/firestore/firestoreE2EAuthorityRouting';
import {
  buildAuthorityPatchSyncContract,
  prepareFirestorePartialData,
} from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';

export { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
export {
  deleteRecordFromFirestore,
  moveRecordToTrash,
} from '@/services/storage/firestore/firestoreRecordLifecycleWrites';

// Waiting ~7 s never fixed these (measured); the SDK's `unknown` and other codes do recover.
const PERMANENT_WRITE_ERROR_CODES = new Set(['not-found', 'invalid-argument', 'permission-denied']);

const shouldRetryWrite = (error: unknown): boolean =>
  !(error instanceof ConcurrencyError) &&
  !(error instanceof DataRegressionError) &&
  !PERMANENT_WRITE_ERROR_CODES.has(String((error as { code?: unknown })?.code));

export const saveRecordToFirestore = async (
  record: DailyRecord,
  expectedLastUpdated?: string,
  options: DailyRecordSaveWriteOptions = {}
) => {
  try {
    const docRef = getRecordDocRef(record.date);
    assertDailyRecordClinicalAuthority(record);

    const callableAuthorityMode = await resolveAuthenticatedDailyRecordAuthorityMode();
    const writeFenceActive = await shouldRouteDailyRecordSaveViaCallable();
    if (callableAuthorityMode === 'enforced' || writeFenceActive) {
      return withRetry(
        () =>
          saveDailyRecordWithClinicalAuthorityCallable({
            date: record.date,
            record,
            expectedLastUpdated,
            mode: 'enforced',
            origin: options.origin ?? 'direct_save',
            syncContract: options.syncContract,
          }),
        {
          onRetry: (err: unknown, attempt: number) =>
            logFirestoreWriteRetry('save', record.date, attempt, err),
          shouldRetry: shouldRetryDailyRecordAuthorityError,
        }
      );
    }

    const committedAt = Timestamp.now();
    const receipt = createDirectFirestoreWriteReceipt(record, committedAt.toDate());
    const sanitizedRecord = sanitizeForFirestore({
      ...receipt.recordState.record,
      lastUpdated: committedAt,
    }) as Record<string, unknown>;

    const persist = () =>
      withRetry(
        () =>
          saveRecordAtomically(
            docRef,
            sanitizedRecord,
            expectedLastUpdated,
            'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
            'save',
            {
              assertSafeOverwrite: options.assertSafeOverwrite,
              forceHistorySnapshot:
                options.historyPolicy === 'snapshot' || options.origin === 'backup_restore',
            }
          ),
        {
          onRetry: (err: unknown, attempt: number) =>
            logFirestoreWriteRetry('save', record.date, attempt, err),
          shouldRetry: shouldRetryWrite,
        }
      );

    let committed: Record<string, unknown>;
    try {
      committed = await persist();
    } catch (error) {
      if (isPermissionDeniedError(error) && (await tryRefreshCurrentUserRoleClaim(record.date))) {
        committed = await persist();
      } else {
        throw error;
      }
    }
    if (options.returnCommittedRecord) {
      // On a split day the transaction kept the stored marker, meta and moved fields (D9).
      return createDirectFirestoreWriteReceipt(
        adoptStoredClinicalDerivedState(record, committed),
        committedAt.toDate()
      );
    }
    // Plain local-first saves stay receipt-less, like the partial update below.
    return undefined;
  } catch (error) {
    logFirestoreWriteError('save', record.date, error);
    throw error;
  }
};

const COMMITTED_RECORD_UNAVAILABLE = {
  code: 'firestore_committed_record_unavailable',
  message: 'No se pudo armar el registro confirmado del parche atómico; se usará la relectura.',
  severity: 'warning',
} as const;

const reportCommittedRecordUnavailable = (
  date: string,
  reason: 'unsupported_payload' | 'conversion_failed' | 'version_mismatch',
  path?: string
) =>
  recordOperationalErrorTelemetry(
    'firestore',
    'atomic_partial_committed_record',
    createOperationalError(COMMITTED_RECORD_UNAVAILABLE),
    COMMITTED_RECORD_UNAVAILABLE,
    { date, context: { reason, ...(path ? { path } : {}) } }
  );

/**
 * Receipt for an atomic partial update: its payload projected onto the base the committing
 * attempt read. Runs after the commit and outside withRetry, where a throw would re-run a committed
 * transaction and report it as a ConcurrencyError; any doubt returns void so the caller falls back
 * to its readback.
 */
const buildAtomicPartialCommitReceipt = (
  date: string,
  baseData: DocumentData,
  payload: DocumentData
): DirectFirestoreWriteReceipt | void => {
  try {
    const committedAt = payload.lastUpdated;
    const record = docToRecord(projectFirestoreUpdate(baseData, payload), date);
    if (
      !(committedAt instanceof Timestamp) ||
      record.date !== date ||
      record.lastUpdated !== committedAt.toDate().toISOString()
    ) {
      reportCommittedRecordUnavailable(date, 'version_mismatch');
      return;
    }
    return createDirectFirestoreWriteReceipt(record, committedAt.toDate());
  } catch (error) {
    if (error instanceof UnsupportedFirestoreUpdateProjectionError) {
      reportCommittedRecordUnavailable(date, 'unsupported_payload', error.path);
    } else {
      reportCommittedRecordUnavailable(date, 'conversion_failed');
    }
  }
};

/**
 * The note callable needs the network, so its client is not precached. It loads through the
 * shared Functions loader: offline it is refused as unavailable, so the note goes to the queue,
 * and a stale chunk asks for a reload while queued notes stay pending.
 */
export const loadSpecialistMedicalHandoffClient = () =>
  loadFunctionsModule(() => import('./specialistMedicalHandoffClient'));

export const updateRecordPartial = async (
  date: string,
  partialData: DailyRecordPatch,
  expectedLastUpdated?: string,
  options: DailyRecordPartialWriteOptions = {}
): Promise<DailyRecordAuthorityCallableResponse | DirectFirestoreWriteReceipt | void> => {
  try {
    const docRef = getRecordDocRef(date);
    // Specialist dot-notation patches must not be re-flattened: Firestore rules reject shape changes.
    const specialistScopedPatch = isSpecialistScopedDailyRecordPatch(partialData);
    const intentionalBedClear = options.intentionalBedClear;
    const flatData = prepareFirestorePartialData({
      partialData: partialData as unknown as Record<string, unknown>,
      specialistScopedPatch,
      intentionalBedClear,
      clinicalCribCreate: Boolean(options.clinicalCribCreate),
    });
    const sanitizedPatch = stripInheritedAuthorityRepair(
      sanitizeForFirestore(flatData) as Record<string, unknown>,
      options.syncContract?.changedPaths
    );
    const sanitizedData = sanitizeForFirestore({
      ...sanitizedPatch,
      lastUpdated: Timestamp.now(),
    }) as Record<string, unknown>;
    const persist = async () => {
      options.assertCanPublish?.();
      if (specialistScopedPatch && (await shouldRouteSpecialistPatchViaCallable())) {
        // This callable has no server version CAS (its transaction protects the patient and
        // episode), so the version is checked by a read first. Every other route checks it when
        // committing: a read here would cost a round trip per edit.
        await assertFirestoreConcurrency(
          docRef,
          expectedLastUpdated,
          'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
          'partial update',
          { toleranceMs: 0, failClosed: true }
        );
        return (await loadSpecialistMedicalHandoffClient()).saveSpecialistMedicalHandoff({
          date,
          patch: sanitizedPatch,
          expectedOccupants: options.specialistHandoffTargets ?? [],
          mutationId: options.syncContract?.mutationId,
        });
      }

      const isClinicalPatchForAuthority = shouldRouteClinicalAuthorityPatch(sanitizedPatch);
      const authorityPatch = extractClinicalAuthorityPatch(sanitizedPatch);
      const authorityPaths = new Set(Object.keys(authorityPatch));
      const hasClinicalAuthorityPatch = authorityPaths.size > 0;
      // Derived compatibility fields are omitted only when every meaningful path belongs to the
      // clinical envelope. A genuinely mixed clinical/structural patch makes this predicate false,
      // so its structural fields remain visible to the fail-closed separation checks below.
      const structuralBedPatch = Object.fromEntries(
        Object.entries(extractDailyRecordBedTreePatch(sanitizedPatch)).filter(
          ([path]) => !authorityPaths.has(path) && !isClinicalPatchForAuthority
        )
      );
      const hasStructuralBedPatch = Object.keys(structuralBedPatch).length > 0;
      const isE2EForcedMovementPatch = isE2EForcedMovementAuthorityPatch(sanitizedPatch);
      const shouldUseAuthorityCallable =
        hasClinicalAuthorityPatch || hasStructuralBedPatch || isE2EForcedMovementPatch;
      const structuralCompanionPaths = Object.keys(sanitizedPatch).filter(
        path => !isDailyRecordBedTreePath(path) && path !== 'dateTimestamp'
      );
      const clinicalAuthorityMode = hasClinicalAuthorityPatch
        ? await resolveAuthenticatedDailyRecordAuthorityMode()
        : null;
      const structuralAuthorityMode = hasStructuralBedPatch
        ? await resolveAuthenticatedDailyRecordAuthorityMode()
        : null;
      const bedTreeAuthorityFenced =
        shouldUseAuthorityCallable && (await shouldRouteStructuralBedPatchViaCallable());
      const structuralAuthorityFenced = hasStructuralBedPatch && bedTreeAuthorityFenced;
      const clinicalAuthorityFenced = hasClinicalAuthorityPatch && bedTreeAuthorityFenced;
      const requiresAuthoritySeparation =
        clinicalAuthorityMode === 'enforced' || bedTreeAuthorityFenced;
      // These three refusals choose the route, not a conflict: the day's queue task saves the edit.
      if (requiresAuthoritySeparation && hasStructuralBedPatch && hasClinicalAuthorityPatch) {
        throw createSavedByQueueRouteError(
          'La edición mezcla campos clínicos y estructurales de cama y debe guardarse por separado.'
        );
      }
      if (
        requiresAuthoritySeparation &&
        hasClinicalAuthorityPatch &&
        !isClinicalPatchForAuthority
      ) {
        throw createSavedByQueueRouteError(
          'La edición mezcla cambios clínicos con otros campos y debe guardarse por separado.'
        );
      }
      if (
        requiresAuthoritySeparation &&
        hasStructuralBedPatch &&
        structuralCompanionPaths.length > 0
      ) {
        throw createSavedByQueueRouteError(
          'La edición mezcla cambios de cama con otros campos y debe guardarse por separado.'
        );
      }
      const callablePatch = isE2EForcedMovementPatch
        ? extractE2EForcedMovementAuthorityPatch(sanitizedPatch)
        : isClinicalPatchForAuthority
          ? authorityPatch
          : structuralBedPatch;
      const callableAuthorityMode = isClinicalPatchForAuthority
        ? clinicalAuthorityMode === 'enforced'
          ? 'enforced'
          : clinicalAuthorityFenced
            ? clinicalAuthorityMode || 'enforced'
            : null
        : isE2EForcedMovementPatch
          ? 'enforced'
          : structuralAuthorityFenced
            ? structuralAuthorityMode || 'enforced'
            : null;
      if (
        shouldUseAuthorityCallable &&
        (callableAuthorityMode === 'enforced' ||
          bedTreeAuthorityFenced ||
          Boolean(intentionalBedClear) ||
          Boolean(options.specialtyIntent))
      ) {
        return withRetry(
          () =>
            patchDailyRecordWithClinicalAuthorityCallable({
              date,
              patch: callablePatch,
              expectedLastUpdated,
              mode: 'enforced',
              origin: 'direct_partial_update',
              intentionalBedClear,
              specialtyIntent: options.specialtyIntent,
              syncContract: buildAuthorityPatchSyncContract(options.syncContract, callablePatch),
            }),
          {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
            shouldRetry: shouldRetryDailyRecordAuthorityError,
          }
        );
      }

      const isStaffingPatch = Object.keys(sanitizedPatch).some(path => STAFFING_PATH.test(path));
      if (options.requireAtomicCas || isStaffingPatch) {
        const committedBase = await withRetry(
          () =>
            updateRecordPartiallyAtomically(
              docRef,
              asFirestoreUpdatePayload(sanitizedData),
              expectedLastUpdated,
              isStaffingPatch
                ? 'El censo cambió. Este cambio de dotación no se guardó. Recarga el censo y revisa la dotación antes de volver a guardar.'
                : 'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
              isStaffingPatch ? 'staffing update' : 'movement reclassification',
              { historyPolicy: options.historyPolicy }
            ),
          {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
            shouldRetry: shouldRetryWrite,
          }
        );
        // Plain local-first writes stay receipt-less, because a returned
        // result sends the controller into its confirm-and-adopt path.
        return options.returnCommittedRecord
          ? buildAtomicPartialCommitReceipt(date, committedBase, sanitizedData)
          : undefined;
      }

      // Offline, a transaction waits for the network and holds the day's write. When the day is not
      // in the local cache this read fails at once, as the version read before the write did, so the
      // edit stays local and goes to the queue. With the day cached, or on a cut that the SDK does
      // not notice yet, it waits like main did. The queue resends these fields through this same
      // function, so the same per-field check decides.
      await getDoc(docRef);

      options.assertCanPublish?.();
      // Outside the transaction: roles the rules do not let write history still save the day.
      if (options.historyPolicy !== 'skip')
        await saveHistorySnapshot(date, { force: options.historyPolicy === 'snapshot' });

      // Checked inside the transaction, so two writers can no longer both pass a read and then
      // overwrite each other. A version newer than this writer's base refuses the write only when
      // it changed a field of this patch to a value other than the one written now. A bed field
      // always needs its base version: the bed may hold another patient or episode by now (ID-01).
      const { baseRecord } = options;
      const changedPaths = Object.keys(sanitizedPatch);
      const acceptsOtherVersion = (stored: DocumentData) => {
        const current = docToRecord(stored, date);
        // An older version is this writer's own edit still on its way, as before.
        if (
          !expectedLastUpdated ||
          Date.parse(current.lastUpdated) <= Date.parse(expectedLastUpdated)
        )
          return true;
        return Boolean(
          baseRecord &&
          changedPaths.every(path => {
            if (isDailyRecordBedTreePath(path)) return false;
            const value = getValueAtPath(current, path);
            return (
              hasSameComparableValue(value, getValueAtPath(baseRecord, path)) ||
              hasSameComparableValue(value, sanitizedPatch[path])
            );
          })
        );
      };
      try {
        const committedBase = await withRetry(
          () =>
            updateRecordPartiallyAtomically(
              docRef,
              asFirestoreUpdatePayload(sanitizedData),
              expectedLastUpdated,
              'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
              'partial update',
              {
                historyPolicy: 'skip',
                acceptsOtherVersion,
                assertCanCommit: options.assertCanPublish,
              }
            ),
          {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
            // A changed session stops here instead of waiting to retry.
            shouldRetry: error => {
              options.assertCanPublish?.();
              return shouldRetryWrite(error);
            },
          }
        );
        // An empty base is the not-stored-yet branch: no read to project the committed record on.
        return options.returnCommittedRecord && Object.keys(committedBase).length
          ? buildAtomicPartialCommitReceipt(date, committedBase, sanitizedData)
          : undefined;
      } catch (error) {
        // Only a field of this edit holding another writer's value refuses it here.
        if (error instanceof ConcurrencyError) throw createFieldChangedElsewhereError();
        throw error;
      }
    };
    // A protected specialty decision already uses the authority callable. Its
    // rejection must never be retried as a legacy patch without that intent.
    if (options.specialtyIntent) return await persist();
    return await runPartialUpdatePersistWithPermissionFallbacks({
      persist,
      date,
      sanitizedPatch,
      expectedLastUpdated,
      syncContract: options.syncContract,
      tryRefreshCurrentUserRoleClaim,
    });
  } catch (error) {
    logFirestoreWriteError('partialUpdate', date, error);
    throw error;
  }
};
