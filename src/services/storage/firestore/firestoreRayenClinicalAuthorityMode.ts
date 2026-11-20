import { doc, getDoc } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

const readServerClinicalWriteFence = async (
  runtime: FirestoreServiceRuntimePort
): Promise<boolean> => {
  const snapshot = await getDoc(
    doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY))
  );
  return snapshot.exists() && snapshot.data().schemaVersion === 2;
};

/**
 * The only source of the daily-record write route: the schema-v2 Rayen policy means the server
 * owns the patient tree, so bed and whole-day writes go through the authority callable.
 *
 * A failed read is read once more, at once, before concluding «no fence». Until 2026-11-20 the
 * route came from a build mode plus this fence, and a save read the policy two or three times
 * (Promise.all in the save router, sequential reads in the queue transport); a second read
 * rescued the first, as in the start-up token race seen live on 31-08 (see
 * firestoreBedTreePermissionFallback). This keeps that tolerance with at most the reads main did,
 * and one when the first answers. If both fail, the rules stay the boundary and the queue keeps
 * the edit.
 */
export const isServerClinicalWriteFenceActive = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<boolean> => {
  try {
    return await readServerClinicalWriteFence(runtime);
  } catch {
    try {
      return await readServerClinicalWriteFence(runtime);
    } catch {
      return false;
    }
  }
};
