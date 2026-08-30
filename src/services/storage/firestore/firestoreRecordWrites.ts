import {
  deleteDoc,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore';
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
  createDeletedRecordRef,
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
import {
  buildAuthorityPatchSyncContract,
  prepareFirestorePartialData,
} from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';

export { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

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
            origin: 'direct_save',
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
    if (!options.rayenClinicalWriteGuard && !options.requireAtomicCas) {
      await assertFirestoreConcurrency(
        docRef,
        expectedLastUpdated,
        'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
        'partial update',
        { toleranceMs: 0, failClosed: true }
      );
    }
    // Specialist patches arrive in correct dot-notation (e.g. "beds.R1.medicalHandoffAudit").
    // flattenObject would recursively expand nested objects into sub-field paths
    // (e.g. "beds.R1.medicalHandoffAudit.lastEditor"), which causes Firestore rules
    // to reject the write because the diff shape changes at the bed level.
    const specialistScopedPatch = isSpecialistScopedDailyRecordPatch(partialData);
    const intentionalBedClear = options.intentionalBedClear;
    const flatData = prepareFirestorePartialData({
      partialData: partialData as unknown as Record<string, unknown>,
      specialistScopedPatch,
      intentionalBedClear,
      clinicalCribCreate: Boolean(options.clinicalCribCreate),
    });
    const sanitizedPatch = sanitizeForFirestore(flatData) as Record<string, unknown>;
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
        const shouldUseAuthorityCallable = hasClinicalAuthorityPatch || hasStructuralBedPatch;
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
        const callablePatch = isClinicalPatchForAuthority ? authorityPatch : structuralBedPatch;
        const callableAuthorityMode = isClinicalPatchForAuthority
          ? clinicalAuthorityMode === 'enforced'
            ? 'enforced'
            : clinicalAuthorityFenced
              ? clinicalAuthorityMode || 'shadow'
              : null
          : structuralAuthorityFenced
            ? structuralAuthorityMode || 'shadow'
            : null;
        if (
          shouldUseAuthorityCallable &&
          (callableAuthorityMode === 'enforced' ||
            bedTreeAuthorityFenced ||
            Boolean(intentionalBedClear))
        ) {
          return withRetry(
            () =>
              patchDailyRecordWithClinicalAuthorityCallable({
                date,
                patch: callablePatch,
                expectedLastUpdated,
                mode: callableAuthorityMode || 'shadow',
                origin: 'direct_partial_update',
                intentionalBedClear,
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
      try {
        return await persist();
      } catch (error) {
        if (isPermissionDeniedError(error) && (await tryRefreshCurrentUserRoleClaim(date))) {
          return await persist();
        } else {
          throw error;
        }
      }
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
export const deleteRecordFromFirestore = async (date: string): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    await withRetry(() => deleteDoc(docRef), {
      onRetry: (err: unknown, attempt: number) =>
        logFirestoreWriteRetry('delete', date, attempt, err),
    });
  } catch (error) {
    logFirestoreWriteError('delete', date, error);
    throw error;
  }
};
export const moveRecordToTrash = async (record: DailyRecord): Promise<void> => {
  try {
    const trashRef = createDeletedRecordRef(record.date);
    await withRetry(() =>
      setDoc(trashRef, {
        ...(sanitizeForFirestore(record) as Record<string, unknown>),
        deletedAt: Timestamp.now(),
        originalDate: record.date,
      })
    );
  } catch (error) {
    logFirestoreWriteError('moveToTrash', record.date, error);
    throw error;
  }
};
