import {
  collection,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  Timestamp,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { createOperationalError } from '@/services/observability/operationalError';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

const getRemoteLastUpdatedIso = (data: Record<string, unknown>): string | undefined => {
  const value = data.lastUpdated;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : undefined;
};

/**
 * Tolerance window for same-session rapid edits (e.g. clicking checkboxes fast).
 * Changes within this window are assumed to come from the same user/tab and
 * are allowed through. Changes older than this are likely from a different
 * PC/session with stale data and are blocked.
 */
const SAME_SESSION_TOLERANCE_MS = 30_000;

export const assertFirestoreConcurrency = async (
  docRef: DocumentReference,
  expectedLastUpdated: string | undefined,
  conflictMessage: string,
  contextLabel: string,
  options: { toleranceMs?: number; failClosed?: boolean } = {}
): Promise<void> => {
  if (!expectedLastUpdated) {
    return;
  }

  try {
    const remoteDoc = await getDoc(docRef);
    if (!remoteDoc.exists()) {
      return;
    }

    const remoteLastUpdated = getRemoteLastUpdatedIso(remoteDoc.data());
    if (!remoteLastUpdated) {
      return;
    }

    const drift = new Date(remoteLastUpdated).getTime() - new Date(expectedLastUpdated).getTime();

    const toleranceMs = options.toleranceMs ?? SAME_SESSION_TOLERANCE_MS;

    if (drift > toleranceMs) {
      recordOperationalErrorTelemetry(
        'firestore',
        'verify_record_concurrency',
        createOperationalError({
          code: 'firestore_concurrency_conflict',
          message: conflictMessage,
          severity: 'warning',
          userSafeMessage: conflictMessage,
          context: {
            contextLabel,
            remoteLastUpdated,
            expectedLastUpdated,
            driftSeconds: Math.round(drift / 1000),
          },
        }),
        {
          code: 'firestore_concurrency_conflict',
          message: conflictMessage,
          severity: 'warning',
          userSafeMessage: conflictMessage,
        }
      );
      throw new ConcurrencyError(conflictMessage);
    }
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      throw error;
    }

    recordOperationalErrorTelemetry('firestore', 'verify_record_concurrency', error, {
      code: 'firestore_concurrency_verification_failed',
      message: `No se pudo verificar concurrencia para ${contextLabel}.`,
      severity: options.failClosed ? 'error' : 'warning',
      userSafeMessage: `No se pudo verificar concurrencia para ${contextLabel}.`,
      context: {
        contextLabel,
      },
    });

    // Fail closed when the caller cannot tolerate an unverified write (e.g. partial updates that
    // could overwrite a field with stale data): abort instead of silently proceeding.
    if (options.failClosed) {
      throw error;
    }
  }
};

/**
 * Writes a daily record using an atomic Firestore transaction that:
 *   1. Reads the current server state (never cache)
 *   2. Throws ConcurrencyError if the remote is newer than expectedLastUpdated
 *   3. Writes a history snapshot of the pre-write state
 *   4. Commits the new record
 *
 * This replaces the previous assertFirestoreConcurrency + saveHistorySnapshot + setDoc
 * three-step sequence, which had a TOCTOU race and could fail open on network errors.
 */
export const saveRecordAtomically = async (
  docRef: DocumentReference,
  record: Record<string, unknown>,
  expectedLastUpdated: string | undefined,
  conflictMessage: string,
  contextLabel: string,
  assertSafeOverwrite?: (remoteData: Record<string, unknown>) => void,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<void> => {
  const db = runtime.getDb();

  await runTransaction(db, async transaction => {
    const snap = await transaction.get(docRef);

    // Refuse to full-replace an existing document without a base version: with no
    // expectedLastUpdated the optimistic CAS below cannot run, so we cannot prove this write is not
    // clobbering a newer remote. Surface it as a conflict so the caller reloads and retries.
    if (snap.exists() && !expectedLastUpdated) {
      recordOperationalErrorTelemetry(
        'firestore',
        'atomic_save_concurrency',
        createOperationalError({
          code: 'firestore_concurrency_conflict',
          message: conflictMessage,
          severity: 'warning',
          userSafeMessage: conflictMessage,
          context: { contextLabel, reason: 'missing_base_version' },
        }),
        {
          code: 'firestore_concurrency_conflict',
          message: conflictMessage,
          severity: 'warning',
          userSafeMessage: conflictMessage,
        }
      );
      throw new ConcurrencyError(conflictMessage);
    }

    if (snap.exists() && expectedLastUpdated) {
      const remoteLastUpdated = getRemoteLastUpdatedIso(snap.data() as Record<string, unknown>);
      if (remoteLastUpdated) {
        const drift =
          new Date(remoteLastUpdated).getTime() - new Date(expectedLastUpdated).getTime();
        if (drift > 0) {
          recordOperationalErrorTelemetry(
            'firestore',
            'atomic_save_concurrency',
            createOperationalError({
              code: 'firestore_concurrency_conflict',
              message: conflictMessage,
              severity: 'warning',
              userSafeMessage: conflictMessage,
              context: {
                contextLabel,
                remoteLastUpdated,
                expectedLastUpdated,
                driftSeconds: Math.round(drift / 1000),
              },
            }),
            {
              code: 'firestore_concurrency_conflict',
              message: conflictMessage,
              severity: 'warning',
              userSafeMessage: conflictMessage,
            }
          );
          throw new ConcurrencyError(conflictMessage);
        }
      }
    }

    if (snap.exists()) {
      // Atomic erasure backstop: validate the new record against the freshly-read remote state
      // INSIDE the transaction. This holds even when expectedLastUpdated is absent (CAS skipped)
      // and closes the TOCTOU window between the pre-write integrity check and this commit.
      assertSafeOverwrite?.(snap.data() as Record<string, unknown>);

      const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());
      transaction.set(historyRef, {
        ...(snap.data() as Record<string, unknown>),
        snapshotTimestamp: Timestamp.now(),
      });
    }

    transaction.set(docRef, record);
  });
};

export const saveHistorySnapshot = async (date: string): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return;
    }

    const data = docSnap.data();
    const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());

    await setDoc(historyRef, {
      ...data,
      snapshotTimestamp: Timestamp.now(),
    });
  } catch (error) {
    recordOperationalErrorTelemetry('firestore', 'save_history_snapshot', error, {
      code: 'firestore_history_snapshot_failed',
      message: 'No se pudo crear el snapshot histórico del registro.',
      severity: 'warning',
      userSafeMessage: 'No se pudo crear el snapshot histórico del registro.',
      context: {
        date,
      },
    });
  }
};

export const createDeletedRecordRef = (
  date: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): DocumentReference =>
  doc(
    runtime.getDb(),
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.DELETED_RECORDS,
    `${date}_trash_${Date.now()}`
  );

export const asFirestoreUpdatePayload = (payload: Record<string, unknown>): DocumentData => payload;
