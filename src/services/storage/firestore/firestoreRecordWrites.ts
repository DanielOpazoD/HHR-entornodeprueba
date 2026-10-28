import {
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
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
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import {
  isPermissionDeniedError,
  logFirestoreWriteError,
  logFirestoreWriteRetry,
  tryRefreshCurrentUserRoleClaim,
} from '@/services/storage/firestore/firestoreRecordWriteUtilities';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';
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
  resolveAuthenticatedDailyRecordAuthorityMode,
  shouldRouteDailyRecordSaveViaCallable,
  shouldRouteClinicalAuthorityPatch,
  shouldRouteStructuralBedPatchViaCallable,
  shouldRouteSpecialistPatchViaCallable,
  tryShadowDailyRecordPatchViaCallable,
  tryShadowDailyRecordSaveViaCallable,
  type DailyRecordPartialWriteOptions,
  type DailyRecordSaveWriteOptions,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  buildGuardedRayenFallbackData,
  extractGuardedRayenClinicalPatch,
} from '@/services/storage/firestore/firestoreRayenGuardedPatch';
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
            mode: callableAuthorityMode || 'shadow',
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

    await tryShadowDailyRecordSaveViaCallable(record, expectedLastUpdated, options.syncContract);

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
          shouldRetry: (err: unknown) =>
            !(err instanceof ConcurrencyError) && !(err instanceof DataRegressionError),
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
    // La verificación de concurrencia por lectura directa sólo protege las rutas
    // SIN CAS de versión del lado servidor (updateDoc directo y el callable specialist,
    // cuya transacción protege además la identidad del paciente y episodio).
    // Las rutas del callable de autoridad y la transacción atómica ya validan
    // versión/revisión al commitear: duplicar la lectura aquí costaba un viaje
    // remoto extra por edición y rechazaba ráfagas legítimas cuando el eco de la
    // edición anterior aún no se adoptaba localmente.
    const assertDirectWriteConcurrency = () =>
      assertFirestoreConcurrency(
        docRef,
        expectedLastUpdated,
        'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
        'partial update',
        { toleranceMs: 0, failClosed: true }
      );
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
    const rayenClinicalWriteGuard = options.rayenClinicalWriteGuard;
    const guardedPatch = rayenClinicalWriteGuard
      ? (sanitizeForFirestore(
          extractGuardedRayenClinicalPatch(
            partialData as unknown as Record<string, unknown>,
            rayenClinicalWriteGuard.recordScope
          )
        ) as Record<string, unknown>)
      : null;
    const guardedFallbackData = guardedPatch
      ? buildGuardedRayenFallbackData(guardedPatch, Timestamp.now())
      : null;
    try {
      const persist = async () => {
        if (specialistScopedPatch && (await shouldRouteSpecialistPatchViaCallable())) {
          await assertDirectWriteConcurrency();
          return (await loadSpecialistMedicalHandoffClient()).saveSpecialistMedicalHandoff({
            date,
            patch: sanitizedPatch,
            expectedOccupants: options.specialistHandoffTargets ?? [],
            mutationId: options.syncContract?.mutationId,
          });
        }

        if (rayenClinicalWriteGuard && guardedPatch) {
          // Build the callable payload from the original shape so clinical objects stay atomic.
          return withRetry(
            () =>
              patchDailyRecordWithClinicalAuthorityCallable({
                date,
                patch: guardedPatch,
                expectedLastUpdated,
                mode: 'shadow',
                origin: 'legacy_guarded_clinical_patch',
                rayenClinicalWriteGuard,
                historyPolicy: options.historyPolicy,
                syncContract: buildAuthorityPatchSyncContract(options.syncContract, guardedPatch),
              }),
            {
              onRetry: (err: unknown, attempt: number) =>
                logFirestoreWriteRetry('partialUpdate', date, attempt, err),
              shouldRetry: shouldRetryDailyRecordAuthorityError,
            }
          );
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
        if (requiresAuthoritySeparation && hasStructuralBedPatch && hasClinicalAuthorityPatch) {
          throw new ConcurrencyError(
            'La edición mezcla campos clínicos y estructurales de cama y debe guardarse por separado.'
          );
        }
        if (
          requiresAuthoritySeparation &&
          hasClinicalAuthorityPatch &&
          !isClinicalPatchForAuthority
        ) {
          throw new ConcurrencyError(
            'La edición mezcla cambios clínicos con otros campos y debe guardarse por separado.'
          );
        }
        if (
          requiresAuthoritySeparation &&
          hasStructuralBedPatch &&
          structuralCompanionPaths.length > 0
        ) {
          throw new ConcurrencyError(
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
              ? clinicalAuthorityMode || 'shadow'
              : null
          : isE2EForcedMovementPatch
            ? 'enforced'
            : structuralAuthorityFenced
              ? structuralAuthorityMode || 'shadow'
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
                mode: options.specialtyIntent ? 'enforced' : callableAuthorityMode || 'shadow',
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

        if (isClinicalPatchForAuthority) {
          await tryShadowDailyRecordPatchViaCallable(
            date,
            authorityPatch,
            expectedLastUpdated,
            buildAuthorityPatchSyncContract(options.syncContract, authorityPatch)
          );
        }
        const isStaffingPatch = Object.keys(sanitizedPatch).some(path =>
          /^(nurses|nurseName|nursesDayShift|nursesNightShift|tensDayShift|tensNightShift|staffingDetailsV1)(\.|$)/.test(
            path
          )
        );
        if (options.requireAtomicCas || isStaffingPatch) {
          const committedBase = await withRetry(
            () =>
              updateRecordPartiallyAtomically(
                docRef,
                asFirestoreUpdatePayload(sanitizedData),
                expectedLastUpdated,
                isStaffingPatch
                  ? 'La dotación cambió en otro equipo. Recarga el censo antes de volver a guardar.'
                  : 'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
                isStaffingPatch ? 'staffing update' : 'movement reclassification',
                { historyPolicy: options.historyPolicy }
              ),
            {
              onRetry: (err: unknown, attempt: number) =>
                logFirestoreWriteRetry('partialUpdate', date, attempt, err),
              shouldRetry: (err: unknown) => !(err instanceof ConcurrencyError),
            }
          );
          // Plain local-first writes stay receipt-less, because a returned
          // result sends the controller into its confirm-and-adopt path.
          return options.returnCommittedRecord
            ? buildAtomicPartialCommitReceipt(date, committedBase, sanitizedData)
            : undefined;
        }

        await assertDirectWriteConcurrency();
        if (options.historyPolicy !== 'skip')
          await saveHistorySnapshot(date, { force: options.historyPolicy === 'snapshot' });

        return withRetry(
          () =>
            updateDoc(docRef, asFirestoreUpdatePayload(sanitizedData) as UpdateData<DocumentData>),
          {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
          }
        );
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
    } catch (error: unknown) {
      const storageError = error as { code?: string };
      if (storageError?.code === 'not-found' && !options.specialtyIntent) {
        firestoreWriteLogger.warn('Firestore write fallback: partialUpdateNotFound', { date });
        await withRetry(() =>
          setDoc(docRef, guardedFallbackData ?? sanitizedData, { merge: true })
        );
      } else {
        throw error;
      }
    }
  } catch (error) {
    logFirestoreWriteError('partialUpdate', date, error);
    throw error;
  }
};
