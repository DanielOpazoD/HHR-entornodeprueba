import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DAILY_RECORD_CONFLICT_SNAPSHOTS } from '@/constants/firestorePaths';
import {
  getRecordDocRef,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

/**
 * Recoverable conflict snapshots auto-expire ~48h after creation via a Firestore TTL policy on the
 * `expireAt` field. The audit trail (logRepositoryConflictAutoMerged / ...VersionRestored) is
 * permanent and independent of these blobs. See docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export const CONFLICT_SNAPSHOT_TTL_MS = 48 * 60 * 60 * 1000;

export type ConflictSnapshotOrigin = 'remote_premerge' | 'incoming_premerge';

export interface ConflictSnapshotSaveResult {
  status: 'saved' | 'failed';
  snapshotIds: string[];
  origins: ConflictSnapshotOrigin[];
  expiresAt?: string;
  ttlMs: number;
}

const sourceLastUpdatedOf = (record: DailyRecord): string =>
  typeof record.lastUpdated === 'string' ? record.lastUpdated : 'na';

/**
 * Deterministic id correlating the two snapshots of one conflict with its audit entry. Derived from
 * the conflicting versions so a retried resolution overwrites (idempotent) instead of duplicating.
 */
export const buildConflictId = (date: string, remote: DailyRecord, incoming: DailyRecord): string =>
  `c_${date}_${sourceLastUpdatedOf(remote)}_${sourceLastUpdatedOf(incoming)}`.replace(
    /[^A-Za-z0-9_-]/g,
    '-'
  );

/**
 * Persists the two pre-merge versions of a daily record (the cloud one and the incoming/local one)
 * so an admin can later restore either via the conflict panel. BEST-EFFORT: a failure here must
 * never block the conflict-resolution flow, so it is swallowed into telemetry. Each snapshot carries
 * `expireAt` for the Firestore TTL policy.
 */
export const saveConflictVersionSnapshots = async (
  date: string,
  conflictId: string,
  versions: { remote: DailyRecord; incoming: DailyRecord },
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<ConflictSnapshotSaveResult> => {
  const entries: { origin: ConflictSnapshotOrigin; record: DailyRecord }[] = [
    { origin: 'remote_premerge', record: versions.remote },
    { origin: 'incoming_premerge', record: versions.incoming },
  ];
  const snapshotIds = entries.map(({ origin }) => [conflictId, origin].join('__'));
  const origins = entries.map(({ origin }) => origin);

  try {
    const db = runtime.getDb();
    const snapshotsRef = collection(
      getRecordDocRef(date, runtime),
      DAILY_RECORD_CONFLICT_SNAPSHOTS
    );
    const snapshotTimestamp = Timestamp.now();
    const expireAtMs = Date.now() + CONFLICT_SNAPSHOT_TTL_MS;
    const expireAt = Timestamp.fromMillis(expireAtMs);

    const batch = writeBatch(db);
    entries.forEach(({ origin, record }, index) => {
      batch.set(doc(snapshotsRef, snapshotIds[index]), {
        origin,
        conflictId,
        snapshotTimestamp,
        expireAt,
        sourceLastUpdated: sourceLastUpdatedOf(record),
        record: sanitizeForFirestore(record) as DocumentData,
      });
    });
    await batch.commit();
    return {
      status: 'saved',
      snapshotIds,
      origins,
      expiresAt: new Date(expireAtMs).toISOString(),
      ttlMs: CONFLICT_SNAPSHOT_TTL_MS,
    };
  } catch (error) {
    recordOperationalErrorTelemetry('firestore', 'save_conflict_version_snapshots', error, {
      code: 'firestore_conflict_snapshot_failed',
      message: 'No se pudieron guardar los snapshots de versión en conflicto.',
      severity: 'warning',
      userSafeMessage: 'No se pudieron guardar los snapshots de versión en conflicto.',
      context: { date, conflictId },
    });
    return {
      status: 'failed',
      snapshotIds: [],
      origins: [],
      ttlMs: CONFLICT_SNAPSHOT_TTL_MS,
    };
  }
};

export interface ConflictVersionSnapshot {
  id: string;
  origin: ConflictSnapshotOrigin;
  conflictId?: string;
  sourceLastUpdated?: string;
  record: DailyRecord;
}

const toConflictVersionSnapshot = (id: string, data: DocumentData): ConflictVersionSnapshot => ({
  id,
  origin: data.origin as ConflictSnapshotOrigin,
  conflictId: typeof data.conflictId === 'string' ? data.conflictId : undefined,
  sourceLastUpdated:
    typeof data.sourceLastUpdated === 'string' ? data.sourceLastUpdated : undefined,
  record: data.record as DailyRecord,
});

/**
 * Whether a snapshot is still within its recovery window. The Firestore TTL policy purges expired
 * blobs asynchronously (up to ~24h after `expireAt`), so the list must not surface — nor let an
 * admin restore — a version that is already past `expireAt`. Defensive: a missing/invalid `expireAt`
 * is treated as recoverable rather than silently hidden.
 */
const isConflictSnapshotRecoverable = (data: DocumentData, nowMs: number): boolean => {
  const expireAt = data.expireAt as { toMillis?: () => number } | undefined;
  if (!expireAt || typeof expireAt.toMillis !== 'function') return true;
  return expireAt.toMillis() > nowMs;
};

/** Lists the recoverable conflict version snapshots still present for a day (admin recovery UI). */
export const listConflictVersionSnapshots = async (
  date: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<ConflictVersionSnapshot[]> => {
  const snapshotsRef = collection(getRecordDocRef(date, runtime), DAILY_RECORD_CONFLICT_SNAPSHOTS);
  const querySnapshot = await getDocs(snapshotsRef);
  const nowMs = Date.now();
  return querySnapshot.docs
    .map(snap => ({ id: snap.id, data: snap.data() }))
    .filter(({ data }) => isConflictSnapshotRecoverable(data, nowMs))
    .map(({ id, data }) => toConflictVersionSnapshot(id, data));
};

/** Reads a single conflict version snapshot (the source for a restore). */
export const getConflictVersionSnapshot = async (
  date: string,
  snapshotId: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<ConflictVersionSnapshot | null> => {
  const snapshotRef = doc(
    collection(getRecordDocRef(date, runtime), DAILY_RECORD_CONFLICT_SNAPSHOTS),
    snapshotId
  );
  const snap = await getDoc(snapshotRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!isConflictSnapshotRecoverable(data, Date.now())) return null;
  return toConflictVersionSnapshot(snap.id, data);
};
