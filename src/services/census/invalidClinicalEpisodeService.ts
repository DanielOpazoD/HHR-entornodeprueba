import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getHospitalPath, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import {
  defaultFirebaseConfigRuntimeAdapter,
  type FirebaseConfigRuntimeAdapter,
} from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

const invalidClinicalEpisodesPath = (): string =>
  `${getHospitalPath()}/${HOSPITAL_COLLECTIONS.INVALID_CLINICAL_EPISODES}`;

/** The seeded E2E runtime has no Firestore backend; its marks come from localStorage. */
export const E2E_INVALID_CLINICAL_EPISODES_KEY = 'hhr_e2e_invalid_clinical_episodes';

/**
 * Marks seeded for E2E, or `null` when the run talks to Firebase. Any localhost counts as an E2E
 * runtime, so a local run against real Firebase must still read the server unless seeded.
 */
const readE2EInvalidClinicalEpisodeIds = (): ReadonlySet<string> | null => {
  if (typeof window === 'undefined' || !isE2ERuntimeEnabled()) return null;
  const seeded = localStorage.getItem(E2E_INVALID_CLINICAL_EPISODES_KEY);
  if (seeded === null && import.meta.env?.VITE_E2E_MODE !== 'true') return null;
  const stored: unknown = JSON.parse(seeded || '[]');
  return new Set(Array.isArray(stored) ? stored.map(String) : []);
};

/**
 * Episodes marked «paciente no válido», read from the server and never from the local cache: a
 * cached list could miss a recent mark and let the sync admit the removed patient again.
 */
export const loadInvalidClinicalEpisodeIds = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<ReadonlySet<string>> => {
  const seeded = readE2EInvalidClinicalEpisodeIds();
  if (seeded) return seeded;
  await ensureFirestoreRuntimeReady(runtime);
  const snapshot = await getDocsFromServer(
    collection(runtime.getDb(), invalidClinicalEpisodesPath())
  );
  return new Set(snapshot.docs.map(document => document.id));
};

export interface InvalidClinicalEpisodeMark {
  clinicalEpisodeId: string;
  /** Census day on which the patient was removed. */
  censusDate: string;
  bedId: string;
}

const MARK_TIMEOUT_MS = 15_000;

/**
 * Marks an Eloísa episode «paciente no válido». The caller removes the patient only after this
 * resolves, so the sync can never bring back a patient that was just removed. The mark is
 * immutable: when another editor marked the same episode first, the outcome is the same.
 */
export const markClinicalEpisodeInvalid = async (
  mark: InvalidClinicalEpisodeMark,
  adapter: FirebaseConfigRuntimeAdapter = defaultFirebaseConfigRuntimeAdapter,
  timeoutMs = MARK_TIMEOUT_MS
): Promise<void> => {
  const clinicalEpisodeId = mark.clinicalEpisodeId.trim();
  if (!clinicalEpisodeId) throw new Error('El paciente no tiene episodio de Eloísa.');
  const seeded = readE2EInvalidClinicalEpisodeIds();
  if (seeded) {
    const marked = [...new Set([...seeded, clinicalEpisodeId])];
    localStorage.setItem(E2E_INVALID_CLINICAL_EPISODES_KEY, JSON.stringify(marked));
    return;
  }
  await adapter.readyFirestore;
  const markedBy = adapter.getAuth().currentUser?.uid;
  if (!markedBy) throw new Error('La sesión no está activa.');
  const reference = doc(adapter.getDb(), invalidClinicalEpisodesPath(), clinicalEpisodeId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Offline, setDoc waits for the server: without a ceiling the action would never answer.
    await Promise.race([
      setDoc(reference, {
        clinicalEpisodeId,
        censusDate: mark.censusDate,
        bedId: mark.bedId,
        markedAt: serverTimestamp(),
        markedBy,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('No se pudo confirmar la marca en el servidor.')),
          timeoutMs
        );
      }),
    ]);
  } catch (error) {
    const existing = await getDocFromServer(reference).catch(() => null);
    if (existing?.exists()) return;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export interface InvalidClinicalEpisodeRecord extends InvalidClinicalEpisodeMark {
  /** ISO instant the server stamped, or null while it is still pending. */
  markedAt: string | null;
  /** Uid of the editor who marked it. */
  markedBy: string;
}

const toIsoInstant = (value: unknown): string | null => {
  const toDate = (value as { toDate?: () => Date } | null)?.toDate;
  return typeof toDate === 'function' ? toDate.call(value).toISOString() : null;
};

/** Every mark, newest first, read from the server for the admin review. */
export const listInvalidClinicalEpisodes = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<InvalidClinicalEpisodeRecord[]> => {
  await ensureFirestoreRuntimeReady(runtime);
  const snapshot = await getDocsFromServer(
    collection(runtime.getDb(), invalidClinicalEpisodesPath())
  );
  return snapshot.docs
    .map(document => {
      const data = document.data();
      return {
        clinicalEpisodeId: document.id,
        censusDate: String(data.censusDate ?? ''),
        bedId: String(data.bedId ?? ''),
        markedAt: toIsoInstant(data.markedAt),
        markedBy: String(data.markedBy ?? ''),
      };
    })
    .sort((left, right) => (right.markedAt ?? '').localeCompare(left.markedAt ?? ''));
};

/**
 * Admin undo. The next sync treats the episode like any other: it comes back while Eloísa keeps
 * it open, or its egreso is filed once Eloísa closes it.
 */
export const removeInvalidClinicalEpisodeMark = async (
  clinicalEpisodeId: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<void> => {
  await ensureFirestoreRuntimeReady(runtime);
  await deleteDoc(doc(runtime.getDb(), invalidClinicalEpisodesPath(), clinicalEpisodeId));
};
