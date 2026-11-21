import {
  collection,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { createOperationalError } from '@/services/observability/operationalError';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import {
  isHistorySnapshotDue,
  markHistorySnapshotTaken,
} from '@/services/storage/firestore/historySnapshotCadence';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

export { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

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
 * Applies a dot-notation partial update in the same transaction that verifies the caller's base
 * version and snapshots the previous document (hourly cadence unless `historyPolicy` says
 * otherwise). Without `acceptsOtherVersion` any other version is refused, as mutations whose
 * invariant spans more than one field need (for example, moving one egreso classification to
 * another). `acceptsOtherVersion` decides, from the stored document, whether a patch may still
 * commit over a version other than its base.
 *
 * Resolves with the document data the committing attempt read. update() carries an updateTime
 * precondition on that read and no trigger writes daily records, so the committed document is
 * exactly that data with `partialData` applied (see firestoreUpdateProjection).
 */
export const updateRecordPartiallyAtomically = async (
  docRef: DocumentReference,
  partialData: DocumentData,
  expectedLastUpdated: string | undefined,
  conflictMessage: string,
  contextLabel: string,
  {
    historyPolicy,
    acceptsOtherVersion,
    assertCanCommit,
  }: {
    historyPolicy?: 'snapshot' | 'skip';
    acceptsOtherVersion?: (stored: DocumentData) => boolean;
    /** Runs in each attempt right before it writes; a throw aborts the write. */
    assertCanCommit?: () => void;
  } = {},
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<DocumentData> => {
  const db = runtime.getDb();
  const captureHistory =
    historyPolicy === 'snapshot' || (historyPolicy !== 'skip' && isHistorySnapshotDue(docRef.path));
  let historyWritten = false;
  const refuse = (context: Record<string, unknown>): never => {
    recordOperationalErrorTelemetry(
      'firestore',
      'atomic_partial_update_concurrency',
      createOperationalError({
        code: 'firestore_concurrency_conflict',
        message: conflictMessage,
        severity: 'warning',
        userSafeMessage: conflictMessage,
        context: { contextLabel, ...context },
      }),
      {
        code: 'firestore_concurrency_conflict',
        message: conflictMessage,
        severity: 'warning',
        userSafeMessage: conflictMessage,
      }
    );
    throw new ConcurrencyError(conflictMessage);
  };

  // runTransaction resolves with the value of the attempt that committed.
  const baseData = await runTransaction(db, async transaction => {
    historyWritten = false;
    const snap = await transaction.get(docRef);

    // A partial mutation can never reconstruct a deleted daily record safely. Reclassification
    // payloads only carry movement arrays, so creating from them would omit beds and metadata.
    if (!snap.exists()) {
      if (!acceptsOtherVersion) return refuse({ reason: 'missing_remote_record' });
      return null;
    }

    const data = snap.data() as DocumentData;
    const remoteLastUpdated = getRemoteLastUpdatedIso(data);
    const remoteVersionMs = Date.parse(remoteLastUpdated || '');
    const expectedVersionMs = Date.parse(expectedLastUpdated || '');
    const sameVersion =
      Number.isFinite(remoteVersionMs) &&
      Number.isFinite(expectedVersionMs) &&
      remoteVersionMs === expectedVersionMs;
    if (!sameVersion && !acceptsOtherVersion?.(data)) {
      refuse(
        expectedLastUpdated
          ? { reason: 'base_version_mismatch', remoteLastUpdated, expectedLastUpdated }
          : { reason: 'missing_base_version' }
      );
    }

    assertCanCommit?.();
    if (captureHistory) {
      const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());
      transaction.set(historyRef, {
        ...data,
        snapshotTimestamp: Timestamp.now(),
      });
      historyWritten = true;
    }
    // The returned base is exact only while this stays a precondition-carrying update().
    transaction.update(docRef, partialData);
    return data;
  });
  if (historyWritten) markHistorySnapshotTaken(docRef.path);
  if (baseData) return baseData;
  // A day not stored yet: the server refuses the update, as rules or not-found, and the caller
  // recovers from that answer as from any plain update.
  assertCanCommit?.();
  await updateDoc(docRef, partialData);
  return {};
};

/**
 * `force` is for explicit 'snapshot' requests, such as the one copy before an import run.
 * `assertCanCommit` runs after the read and before the copy is written; its throw stops the write
 * and reaches the caller instead of counting as an ordinary history failure.
 */
export const saveHistorySnapshot = async (
  date: string,
  { force = false, assertCanCommit }: { force?: boolean; assertCanCommit?: () => void } = {}
): Promise<void> => {
  let documentPath: string | undefined;
  try {
    const docRef = getRecordDocRef(date);
    documentPath = docRef.path;
    if (!force && !isHistorySnapshotDue(documentPath)) return;
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return;
    }

    const data = docSnap.data();
    const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());
    assertCanCommit?.();

    await setDoc(historyRef, {
      ...data,
      snapshotTimestamp: Timestamp.now(),
    });
    markHistorySnapshotTaken(docRef.path);
  } catch (error) {
    assertCanCommit?.();
    // Roles the rules do not let write history would otherwise re-read the whole day on every
    // save; one denied attempt per hour is enough.
    if (documentPath && (error as { code?: unknown })?.code === 'permission-denied') {
      markHistorySnapshotTaken(documentPath);
    }
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
