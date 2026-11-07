import type { Firestore } from 'firebase/firestore';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export type FirestoreRestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
};

const firestoreRestOrigin = (): string => {
  const emulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
  return import.meta.env.DEV && emulatorHost
    ? `http://${emulatorHost}`
    : 'https://firestore.googleapis.com';
};

/**
 * A document's fields as the Firestore server stores them, or null when the server answers that it
 * does not exist. Read straight from the server with the person's own session: the SDK can't be
 * used, because its server reads answer from a listener's view, which is where a stale «does not
 * exist» lived on 2026-11-07. `fieldPaths` limits the answer to those fields.
 */
export const readFirestoreDocumentFromServer = async (
  db: Firestore,
  path: string,
  fieldPaths: string[] = []
): Promise<Record<string, FirestoreRestValue> | null> => {
  // An answer obtained with the previous person's session is never applied to the next one.
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  const sameSession = () =>
    owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
  const mask = fieldPaths.map(field => `mask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const url = `${firestoreRestOrigin()}/v1/projects/${db.app.options.projectId}/databases/(default)/documents/${path}${mask ? `?${mask}` : ''}`;
  const response = await fetch(url, {
    headers: await resolveCurrentUserAuthHeaders(),
    cache: 'no-store',
  });
  const body = response.ok
    ? ((await response.json()) as { fields?: Record<string, FirestoreRestValue> })
    : null;
  // Checked once the whole answer is in: the session may change while the body is still arriving.
  if (!sameSession()) {
    throw Object.assign(new Error('La sesión cambió mientras se leía el servidor.'), {
      code: 'cancelled',
    });
  }
  if (response.status === 404) return null;
  if (!body) {
    throw Object.assign(
      new Error(`El servidor no respondió la lectura (HTTP ${response.status}).`),
      {
        code:
          response.status === 401 || response.status === 403 ? 'permission-denied' : 'unavailable',
      }
    );
  }
  return body.fields ?? {};
};
