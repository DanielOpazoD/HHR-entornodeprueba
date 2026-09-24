import { setDoc, Timestamp, updateDoc, type DocumentData, type UpdateData } from 'firebase/firestore';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import { withRetry } from '@/utils/networkUtils';
import { DataRegressionError } from '@/utils/integrityGuard';
import {
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
  updateSpecialistMedicalHandoffViaCallable,
  type DailyRecordPartialWriteOptions,
  type DailyRecordSaveWriteOptions,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  buildGuardedRayenFallbackData,
  extractGuardedRayenClinicalPatch,
} from '@/services/storage/firestore/firestoreRayenGuardedPatch';
import { createDirectFirestoreWriteReceipt } from './firestoreDirectWriteReceipt';
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
            options.assertSafeOverwrite
          ),
        {
          onRetry: (err: unknown, attempt: number) =>
            logFirestoreWriteRetry('save', record.date, attempt, err),
          shouldRetry: (err: unknown) =>
            !(err instanceof ConcurrencyError) && !(err instanceof DataRegressionError),
        }
      );

    try {
      await persist();
    } catch (error) {
      if (isPermissionDeniedError(error) && (await tryRefreshCurrentUserRoleClaim(record.date))) {
        await persist();
      } else {
        throw error;
      }
    }
    if (options.returnCommittedRecord) return receipt;
  } catch (error) {
    logFirestoreWriteError('save', record.date, error);
    throw error;
  }
};
export const updateRecordPartial = async (
  date: string,
  partialData: DailyRecordPatch,
  expectedLastUpdated?: string,
  options: DailyRecordPartialWriteOptions = {}
): Promise<DailyRecordAuthorityCallableResponse | void> => {
  try {
    const docRef = getRecordDocRef(date);
    // La verificación de concurrencia por lectura directa sólo protege las rutas
    // SIN CAS del lado servidor (updateDoc directo y el callable specialist).
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
          return withRetry(() => updateSpecialistMedicalHandoffViaCallable(date, sanitizedPatch), {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
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
        if (options.requireAtomicCas) {
          return withRetry(
            () =>
              updateRecordPartiallyAtomically(
                docRef,
                asFirestoreUpdatePayload(sanitizedData),
                expectedLastUpdated,
                'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
                'movement reclassification'
              ),
            {
              onRetry: (err: unknown, attempt: number) =>
                logFirestoreWriteRetry('partialUpdate', date, attempt, err),
              shouldRetry: (err: unknown) => !(err instanceof ConcurrencyError),
            }
          );
        }

        await assertDirectWriteConcurrency();
        if (options.historyPolicy !== 'skip') await saveHistorySnapshot(date);

        return withRetry(
          () =>
            updateDoc(docRef, asFirestoreUpdatePayload(sanitizedData) as UpdateData<DocumentData>),
          {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
          }
        );
      };
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
      if (storageError?.code === 'not-found') {
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
