import { Timestamp, type Firestore } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import {
  readFirestoreDocumentFromServer,
  type FirestoreRestValue,
} from '@/services/storage/firestore/firestoreServerDocumentRead';

const fromRestValue = (value: FirestoreRestValue): unknown => {
  if (value.timestampValue !== undefined) return Timestamp.fromDate(new Date(value.timestampValue));
  if (value.integerValue !== undefined) return Number(value.integerValue);
  return value.stringValue ?? value.doubleValue ?? value.booleanValue ?? null;
};

/**
 * The policy as stored, or null when the server answers that it does not exist. Loaded only when a
 * listener says the policy is missing, because that answer may come from a stale local cache.
 */
const readRayenImportPolicyFromServer = async (
  db: Firestore
): Promise<Record<string, unknown> | null> => {
  const fields = await readFirestoreDocumentFromServer(
    db,
    getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY)
  );
  return (
    fields &&
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromRestValue(value)]))
  );
};

// Default export keeps the lazy call site small: the sync button's chunk is at its byte limit.
export default readRayenImportPolicyFromServer;
