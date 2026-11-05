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

const readE2EInvalidClinicalEpisodeIds = (): ReadonlySet<string> => {
  const stored: unknown = JSON.parse(
    localStorage.getItem(E2E_INVALID_CLINICAL_EPISODES_KEY) || '[]'
  );
  return new Set(Array.isArray(stored) ? stored.map(String) : []);
};

/**
 * Episodes marked «paciente no válido», read from the server and never from the local cache: a
 * cached list could miss a recent mark and let the sync admit the removed patient again.
 */
export const loadInvalidClinicalEpisodeIds = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<ReadonlySet<string>> => {
  if (isE2ERuntimeEnabled() && typeof window !== 'undefined') {
    return readE2EInvalidClinicalEpisodeIds();
  }
  await ensureFirestoreRuntimeReady(runtime);
  const snapshot = await getDocsFromServer(
    collection(runtime.getDb(), invalidClinicalEpisodesPath())
  );
  return new Set(snapshot.docs.map(document => document.id));
};
