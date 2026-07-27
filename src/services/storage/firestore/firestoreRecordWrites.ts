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
  flattenObject,
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
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';
import { ensureUserRoleClaim } from '@/services/auth/authClaimSyncService';
import { resolveFirebaseUserRole } from '@/services/auth/authAccessResolution';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { resolveDailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  saveDailyRecordWithClinicalAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import {
  assertDailyRecordClinicalAuthority,
  extractClinicalAuthorityPatch,
  shouldRouteClinicalAuthorityPatch,
  shouldRouteDailyRecordSaveViaCallable,
  shouldRouteSpecialistPatchViaCallable,
  tryShadowDailyRecordPatchViaCallable,
  tryShadowDailyRecordSaveViaCallable,
  updateSpecialistMedicalHandoffViaCallable,
  type DailyRecordPartialWriteOptions,
  type DailyRecordSaveWriteOptions,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';

const logFirestoreWriteRetry = (
  operation: 'save' | 'partialUpdate' | 'delete',
  date: string,
  attempt: number,
  error: unknown
): void => {
  firestoreWriteLogger.warn(`Firestore write retry: ${operation}`, {
    attempt,
    date,
    error,
  });
};

const logFirestoreWriteError = (
  operation: 'save' | 'partialUpdate' | 'delete' | 'moveToTrash',
  date: string,
  error: unknown
): void => {
  firestoreWriteLogger.error(`Firestore write failed: ${operation}`, {
    date,
    error,
  });
};

const isPermissionDeniedError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code || '').toLowerCase();
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();

  return (
    code.includes('permission-denied') || message.includes('missing or insufficient permissions')
  );
};

const tryRefreshCurrentUserRoleClaim = async (date: string): Promise<boolean> => {
  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (!firebaseUser || firebaseUser.isAnonymous) {
      return false;
    }

    const resolvedRole = await resolveFirebaseUserRole(firebaseUser);
    if (!resolvedRole) {
      return false;
    }

    await ensureUserRoleClaim(firebaseUser, resolvedRole);
    firestoreWriteLogger.warn('Firestore write auth refresh succeeded', {
      date,
      resolvedRole,
      uid: firebaseUser.uid,
    });
    return true;
  } catch (error) {
    firestoreWriteLogger.warn('Firestore write auth refresh failed', {
      date,
      error,
    });
    return false;
  }
};

export { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

const buildAuthorityPatchSyncContract = (
  syncContract: SyncTaskContract | undefined,
  authorityPatch: Record<string, unknown>
): SyncTaskContract | undefined => {
  if (!syncContract) {
    return undefined;
  }

  const authorityPaths = Object.keys(authorityPatch);
  const changedPaths = (syncContract.changedPaths ?? []).filter(path =>
    authorityPaths.includes(path)
  );

  return {
    ...syncContract,
    changedPaths: changedPaths.length > 0 ? changedPaths : authorityPaths,
  };
};

export const saveRecordToFirestore = async (
  record: DailyRecord,
  expectedLastUpdated?: string,
  options: DailyRecordSaveWriteOptions = {}
): Promise<void> => {
  try {
    const docRef = getRecordDocRef(record.date);

    assertDailyRecordClinicalAuthority(record);

    if (await shouldRouteDailyRecordSaveViaCallable()) {
      await withRetry(
        () =>
          saveDailyRecordWithClinicalAuthorityCallable({
            date: record.date,
            record,
            expectedLastUpdated,
            mode: resolveDailyRecordAuthorityMode() === 'enforced' ? 'enforced' : 'shadow',
            origin: 'direct_save',
            syncContract: options.syncContract,
          }),
        {
          onRetry: (err: unknown, attempt: number) =>
            logFirestoreWriteRetry('save', record.date, attempt, err),
        }
      );
      return;
    }

    await tryShadowDailyRecordSaveViaCallable(record, expectedLastUpdated, options.syncContract);

    const sanitizedRecord = sanitizeForFirestore({
      ...record,
      lastUpdated: Timestamp.now(),
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
): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    await assertFirestoreConcurrency(
      docRef,
      expectedLastUpdated,
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
      'partial update',
      { toleranceMs: 0, failClosed: true }
    );

    // Specialist patches arrive in correct dot-notation (e.g. "beds.R1.medicalHandoffAudit").
    // flattenObject would recursively expand nested objects into sub-field paths
    // (e.g. "beds.R1.medicalHandoffAudit.lastEditor"), which causes Firestore rules
    // to reject the write because the diff shape changes at the bed level.
    const specialistScopedPatch = isSpecialistScopedDailyRecordPatch(partialData);
    const flatData = specialistScopedPatch
      ? (partialData as unknown as Record<string, unknown>)
      : flattenObject(partialData as unknown as Record<string, unknown>);
    const sanitizedPatch = sanitizeForFirestore(flatData) as Record<string, unknown>;
    const sanitizedData = sanitizeForFirestore({
      ...sanitizedPatch,
      lastUpdated: Timestamp.now(),
    }) as Record<string, unknown>;

    try {
      const persist = async () => {
        if (specialistScopedPatch && (await shouldRouteSpecialistPatchViaCallable())) {
          return withRetry(() => updateSpecialistMedicalHandoffViaCallable(date, sanitizedPatch), {
            onRetry: (err: unknown, attempt: number) =>
              logFirestoreWriteRetry('partialUpdate', date, attempt, err),
          });
        }

        const isClinicalPatchForAuthority = shouldRouteClinicalAuthorityPatch(sanitizedPatch);
        const authorityPatch = extractClinicalAuthorityPatch(sanitizedPatch);
        if (isClinicalPatchForAuthority && (await shouldRouteDailyRecordSaveViaCallable())) {
          return withRetry(
            () =>
              patchDailyRecordWithClinicalAuthorityCallable({
                date,
                patch: authorityPatch,
                expectedLastUpdated,
                mode: resolveDailyRecordAuthorityMode() === 'enforced' ? 'enforced' : 'shadow',
                origin: 'direct_partial_update',
                syncContract: buildAuthorityPatchSyncContract(options.syncContract, authorityPatch),
              }),
            {
              onRetry: (err: unknown, attempt: number) =>
                logFirestoreWriteRetry('partialUpdate', date, attempt, err),
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
        await persist();
      } catch (error) {
        if (isPermissionDeniedError(error) && (await tryRefreshCurrentUserRoleClaim(date))) {
          await persist();
        } else {
          throw error;
        }
      }
    } catch (error: unknown) {
      const storageError = error as { code?: string };
      if (storageError?.code === 'not-found') {
        firestoreWriteLogger.warn('Firestore write fallback: partialUpdateNotFound', { date });
        await withRetry(() => setDoc(docRef, sanitizedData, { merge: true }));
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
