import { collection, getDocsFromServer } from 'firebase/firestore';
import { getHospitalPath, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';

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
