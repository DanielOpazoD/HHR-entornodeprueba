import { Timestamp, type Firestore } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

type RestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
};

const fromRestValue = (value: RestValue): unknown => {
  if (value.timestampValue !== undefined) return Timestamp.fromDate(new Date(value.timestampValue));
  if (value.integerValue !== undefined) return Number(value.integerValue);
  return value.stringValue ?? value.doubleValue ?? value.booleanValue ?? null;
};

/**
 * The policy as stored, or null when the server answers that it does not exist. Read straight from
 * the Firestore server with the person's own session: the SDK can't be used, because its server
 * reads answer from the listener's view, which is where a stale «does not exist» lived on
 * 2026-11-07. Loaded only when a listener says the policy is missing.
 */
const readRayenImportPolicyFromServer = async (
  db: Firestore
): Promise<Record<string, unknown> | null> => {
  // An answer obtained with the previous person's session is never applied to the next one.
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  const sameSession = () =>
    owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
  const url = `https://firestore.googleapis.com/v1/projects/${db.app.options.projectId}/databases/(default)/documents/${getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY)}`;
  const response = await fetch(url, {
    headers: await resolveCurrentUserAuthHeaders(),
    cache: 'no-store',
  });
  if (!sameSession()) {
    throw Object.assign(new Error('La sesión cambió mientras se leía la política.'), {
      code: 'cancelled',
    });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw Object.assign(new Error(`La política no se pudo leer (HTTP ${response.status}).`), {
      code:
        response.status === 401 || response.status === 403 ? 'permission-denied' : 'unavailable',
    });
  }
  const { fields = {} } = (await response.json()) as { fields?: Record<string, RestValue> };
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromRestValue(value)])
  );
};

// Default export keeps the lazy call site small: the sync button's chunk is at its byte limit.
export default readRayenImportPolicyFromServer;
