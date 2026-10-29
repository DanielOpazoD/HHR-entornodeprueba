import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  type DocumentData,
} from 'firebase/firestore';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import {
  CLINICAL_DERIVED_COLLECTION,
  isClinicalDerivedDocId,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';
import { docToRecord, getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

/**
 * Reads the server-written `clinicalDerived` episode documents of a day. Every failure comes back
 * typed, never as "no documents": a reader that cannot tell a failed read from an empty one would
 * show or write the day's stale embedded copies. A denial is not reported to the session
 * permission-storm detector: before the rules are deployed it means "not active yet", not a broken
 * session.
 *
 * Only documents of the day's current layout (its date and marker generation) are validated and
 * returned; leftovers of a deleted day are skipped unread (D14), so a malformed leftover never
 * fails the read. A current document that fails validation fails the whole read.
 */

export type ClinicalDerivedReadSource = 'default' | 'server';

export interface ClinicalDerivedReadOptions {
  /** `server` bypasses the local cache; strict readers must use it. */
  source?: ClinicalDerivedReadSource;
  runtime?: FirestoreServiceRuntimePort;
}

export type ClinicalDerivedReadFailure =
  | { status: 'permission_denied'; code: string }
  | { status: 'failed'; code: string };

/** `fromCache`: answered by the local cache (offline), which may lack documents. */
export type ClinicalDerivedEpisodeDocsReadResult =
  | { status: 'resolved'; docs: ClinicalDerivedEpisodeDoc[]; fromCache: boolean }
  | ClinicalDerivedReadFailure;

export type ClinicalDerivedEpisodeDocReadResult =
  | { status: 'resolved'; doc: ClinicalDerivedEpisodeDoc | null; fromCache: boolean }
  | ClinicalDerivedReadFailure;

const INVALID_DOCUMENT_CODE = 'invalid_document';

class InvalidClinicalDerivedDocError extends Error {
  readonly code = INVALID_DOCUMENT_CODE;
}

const isCurrentLayoutDoc = (
  data: DocumentData | undefined,
  date: string,
  layoutGeneration: string
): boolean => data?.date === date && data?.layoutGeneration === layoutGeneration;

const parseEpisodeDoc = (id: string, data: DocumentData | undefined): ClinicalDerivedEpisodeDoc => {
  const parsed = ClinicalDerivedEpisodeDocSchema.safeParse(data);
  if (!parsed.success || parsed.data.clinicalEpisodeId !== id) {
    throw new InvalidClinicalDerivedDocError('Invalid clinicalDerived episode document.');
  }
  return parsed.data;
};

const errorCodeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : 'unknown';
};

const toFailure = (
  date: string,
  scope: 'day' | 'episode',
  error: unknown
): ClinicalDerivedReadFailure => {
  const code = errorCodeOf(error);
  // Codes only, never the raw exception; the telemetry sanitizer turns the code into its issue.
  recordOperationalTelemetry({
    category: 'firestore',
    operation: 'clinical_derived_read',
    status: 'degraded',
    runtimeState: 'degraded',
    date,
    issues: [code],
    context: { readScope: scope, errorCode: code },
  });
  return code === 'permission-denied'
    ? { status: 'permission_denied', code }
    : { status: 'failed', code };
};

const episodesCollection = (date: string, runtime: FirestoreServiceRuntimePort) =>
  collection(getRecordDocRef(date, runtime), CLINICAL_DERIVED_COLLECTION);

/** The day's episode documents of the given marker generation. */
export const readClinicalDerivedEpisodeDocs = async (
  date: string,
  layoutGeneration: string,
  { source = 'default', runtime = defaultFirestoreServiceRuntime }: ClinicalDerivedReadOptions = {}
): Promise<ClinicalDerivedEpisodeDocsReadResult> => {
  try {
    const episodes = episodesCollection(date, runtime);
    const snapshot =
      source === 'server' ? await getDocsFromServer(episodes) : await getDocs(episodes);
    return {
      status: 'resolved',
      docs: snapshot.docs
        .filter(item => isCurrentLayoutDoc(item.data(), date, layoutGeneration))
        .map(item => parseEpisodeDoc(item.id, item.data())),
      fromCache: snapshot.metadata.fromCache,
    };
  } catch (error) {
    return toFailure(date, 'day', error);
  }
};

/**
 * One episode's document of the given generation, or `doc: null` when it has none. An id that
 * cannot be a document id never has one (its fields stay embedded in the day), so it resolves
 * without a read.
 */
export const readClinicalDerivedEpisodeDoc = async (
  date: string,
  layoutGeneration: string,
  clinicalEpisodeId: string,
  { source = 'default', runtime = defaultFirestoreServiceRuntime }: ClinicalDerivedReadOptions = {}
): Promise<ClinicalDerivedEpisodeDocReadResult> => {
  if (!isClinicalDerivedDocId(clinicalEpisodeId)) {
    return { status: 'resolved', doc: null, fromCache: false };
  }
  try {
    const ref = doc(episodesCollection(date, runtime), clinicalEpisodeId);
    const snapshot = source === 'server' ? await getDocFromServer(ref) : await getDoc(ref);
    const data = snapshot.exists() ? snapshot.data() : undefined;
    return {
      status: 'resolved',
      doc: isCurrentLayoutDoc(data, date, layoutGeneration)
        ? parseEpisodeDoc(snapshot.id, data)
        : null,
      fromCache: snapshot.metadata.fromCache,
    };
  } catch (error) {
    return toFailure(date, 'episode', error);
  }
};

/** The day as the server holds it, with the documents of its current generation. */
export type ClinicalDerivedDaySnapshotReadResult =
  | { status: 'resolved'; day: DailyRecord; docs: ClinicalDerivedEpisodeDoc[] }
  | { status: 'missing' }
  | ClinicalDerivedReadFailure;

const DAY_CHANGED_CODE = 'day_changed';

/** What every server write of an episode document also changes in its day (D2, D3). */
const dayVersionOf = (data: DocumentData | undefined): string => {
  const layout = readClinicalDerivedLayout(data);
  return JSON.stringify([
    layout.status === 'marked' ? layout.layout.generation : null,
    data?.meta?.revision ?? null,
  ]);
};

export type ClinicalDerivedBackupReadResult =
  | Extract<ClinicalDerivedDaySnapshotReadResult, { status: 'resolved' }>
  | ((ClinicalDerivedReadFailure | { status: 'missing' }) & {
      unconfirmedDocs?: ClinicalDerivedEpisodeDoc[];
    });

const readDaySnapshot = async (
  date: string,
  runtime: FirestoreServiceRuntimePort,
  layoutGeneration?: string
): Promise<ClinicalDerivedBackupReadResult> => {
  let docs: ClinicalDerivedEpisodeDoc[] | undefined;
  const retain = (failure: ClinicalDerivedReadFailure | { status: 'missing' }) =>
    layoutGeneration !== undefined && docs !== undefined
      ? { ...failure, unconfirmedDocs: docs }
      : failure;
  try {
    const dayRef = getRecordDocRef(date, runtime);
    const before = await getDocFromServer(dayRef).catch(error => toFailure(date, 'day', error));
    if (layoutGeneration === undefined) {
      if ('status' in before) return before;
      if (!before.exists()) return { status: 'missing' };
    }
    const data = 'status' in before ? undefined : before.data();
    const layout = readClinicalDerivedLayout(data);
    const generation =
      layoutGeneration ?? (layout.status === 'marked' ? layout.layout.generation : undefined);
    const read = generation
      ? await readClinicalDerivedEpisodeDocs(date, generation, {
          source: 'server',
          runtime,
        })
      : null;
    if (read && read.status !== 'resolved') return read;
    docs = read?.docs ?? [];
    if ('status' in before) return retain(before);
    if (!before.exists()) return retain({ status: 'missing' });
    const day = docToRecord(before.data(), date);
    if (
      layoutGeneration !== undefined &&
      (layout.status !== 'marked' || layout.layout.generation !== layoutGeneration)
    ) {
      return retain({ status: 'failed', code: 'generation_mismatch' });
    }
    const after = read ? await getDocFromServer(dayRef) : before;
    // A race, not a broken read: no telemetry, the caller reports the day it could not confirm.
    if (
      dayVersionOf(after.data()) !== dayVersionOf(before.data()) ||
      before.metadata.hasPendingWrites ||
      after.metadata.hasPendingWrites
    ) {
      return retain({ status: 'failed', code: DAY_CHANGED_CODE });
    }
    return { status: 'resolved', day, docs };
  } catch (error) {
    return retain(toFailure(date, 'day', error));
  }
};

/**
 * The day and its current episode documents in one coherent server read: the day, its
 * generation's documents, then the day again. The server writes a document in the same
 * transaction as the day revision it records (D2), so a day whose generation and revision did not
 * change in between holds exactly those documents. A day that changed, or was deleted, in between
 * fails as `day_changed`, as does one this client still has unconfirmed writes for: that is not
 * yet what the server holds. An unmarked day has no documents to read.
 */
export const readClinicalDerivedDaySnapshot = async (
  date: string,
  { runtime = defaultFirestoreServiceRuntime }: Pick<ClinicalDerivedReadOptions, 'runtime'> = {}
): Promise<ClinicalDerivedDaySnapshotReadResult> => {
  const read = await readDaySnapshot(date, runtime);
  if (read.status === 'resolved') return read;
  return read.status === 'missing'
    ? { status: 'missing' }
    : { status: read.status, code: read.code };
};

/** Retains the requested generation's documents for a backup, even when the day cannot confirm them. */
export const readClinicalDerivedBackupDay = (
  date: string,
  layoutGeneration: string,
  { runtime = defaultFirestoreServiceRuntime }: Pick<ClinicalDerivedReadOptions, 'runtime'> = {}
): Promise<ClinicalDerivedBackupReadResult> => readDaySnapshot(date, runtime, layoutGeneration);
