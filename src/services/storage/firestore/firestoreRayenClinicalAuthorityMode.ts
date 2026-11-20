import { doc, getDoc } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

/**
 * The only source of the daily-record write route: the schema-v2 Rayen policy means the server
 * owns the patient tree, so bed and whole-day writes go through the authority callable.
 */
export const isServerClinicalWriteFenceActive = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<boolean> => {
  try {
    const snapshot = await getDoc(
      doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY))
    );
    return snapshot.exists() && snapshot.data().schemaVersion === 2;
  } catch {
    // Rules remain the final fail-closed boundary if this advisory routing read is unavailable.
    return false;
  }
};
