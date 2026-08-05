import { doc, getDoc } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import type { DailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';
import { resolveDailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

const readServerClinicalAuthorityMode = async (
  runtime: FirestoreServiceRuntimePort
): Promise<DailyRecordAuthorityMode | null> => {
  const snapshot = await getDoc(
    doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY))
  );
  if (!snapshot.exists()) return null;
  const policy = snapshot.data();
  if (policy.schemaVersion !== 2) return null;
  switch (policy.clinicalBatchMode) {
    case 'enforced':
      return 'enforced';
    case 'shadow':
      return 'shadow';
    case 'off':
      return 'client_only';
    default:
      return null;
  }
};

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

const AUTHORITY_MODE_RANK: Record<DailyRecordAuthorityMode, number> = {
  client_only: 0,
  shadow: 1,
  enforced: 2,
};

const strongestAuthorityMode = (
  configuredMode: DailyRecordAuthorityMode,
  serverMode: DailyRecordAuthorityMode | null
): DailyRecordAuthorityMode => {
  if (!serverMode) return configuredMode;
  return AUTHORITY_MODE_RANK[serverMode] > AUTHORITY_MODE_RANK[configuredMode]
    ? serverMode
    : configuredMode;
};

export const isServerClinicalBatchEnforced = async (
  runtime: FirestoreServiceRuntimePort
): Promise<boolean> => {
  try {
    return (await readServerClinicalAuthorityMode(runtime)) === 'enforced';
  } catch {
    // Firestore rules remain the final fail-closed fence. A transient policy read must not
    // manufacture authority; the direct write will be rejected if enforcement is already live.
    return false;
  }
};

/**
 * Resolves the writer from both deployment configuration and the server-owned Rayen policy.
 * This prevents a correctly updated client configured as `client_only` from attempting a direct
 * beds write after an administrator promotes clinical batching to `enforced`.
 */
export const resolveEffectiveDailyRecordAuthorityMode = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<DailyRecordAuthorityMode> => {
  const configuredMode = resolveDailyRecordAuthorityMode();
  try {
    // Rayen can promote a stale client so server-owned clinical fields remain protected, but it
    // must never weaken the independent daily-record authority configured for the deployment.
    return strongestAuthorityMode(configuredMode, await readServerClinicalAuthorityMode(runtime));
  } catch {
    return configuredMode;
  }
};
